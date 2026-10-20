import path from 'node:path'
import {realpath,readdir,lstat,readlink} from 'node:fs/promises'
import semver from 'semver'
import {readJson,fileHash,safeRelative,digest} from './files.mjs'
import {isHostPackage,dependencyIdentity} from '@dsh-depot/offline-format/host-packages'
import {validPackageName} from '../contracts/validate.mjs'
import {fail,LIMITS} from '../contracts/constants.mjs'
export const exportExcluded=name=>['node_modules','.git','.npmrc','.cache','logs','.logs','depot-manifest.json','depot-files.json'].includes(name)||/^\.env(?:\.|$)/.test(name)||name.endsWith('.log')
export const fileIdentity=s=>`${s.dev}:${s.ino}:${s.size}:${s.mtimeMs}:${s.ctimeMs}:${s.mode}`
export function checkExportAbort(signal){if(signal?.aborted)fail('ABORT_ERR','导出已取消')}
export async function installedDependency(root,name){
 if(!validPackageName(name))fail('INVALID_PACKAGE_NAME','依赖包名无效')
 let current=root
 while(true){
  try{return await realpath(path.join(current,'node_modules',name))}catch(e){if(!['ENOENT','ENOTDIR'].includes(e.code))throw e}
  const parent=path.dirname(current);if(parent===current)return null;current=parent
 }
}
export async function exportedPeerVersion(host,name){
 if(isHostPackage(name))return host.version
 if(host.providedPeers?.[name])return host.providedPeers[name]
 const dir=host.dshRoot&&await installedDependency(host.dshRoot,name)
 return dir?(await readJson(path.join(dir,'package.json'))).version:null
}
export async function listExportFiles(root,{budget,limits,signal,exclusions,nodeId}={}){
 const files=[],seen=new Set()
 async function visit(dir,prefix=''){
  checkExportAbort(signal)
  for(const entry of (await readdir(dir,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
   checkExportAbort(signal)
   const rel=safeRelative(prefix+entry.name)
   if(exportExcluded(entry.name)){if(entry.name!=='node_modules')exclusions?.push({nodeId,path:rel});continue}
   if(rel.split('/').length>limits.maxDepth||seen.has(rel.toLowerCase()))fail('RESOURCE_LIMIT','目录过深或存在大小写冲突')
   seen.add(rel.toLowerCase());if(++budget.entries>limits.maxEntries)fail('RESOURCE_LIMIT','导出条目超过限制')
   const file=path.join(dir,entry.name),s=await lstat(file),record={path:rel,identity:fileIdentity(s),mode:s.mode&0o111?0o755:0o644}
   if(s.isDirectory()){files.push({...record,type:'directory'});await visit(file,rel+'/')}
   else if(s.isFile()){
    budget.bytes+=s.size;if(budget.bytes>limits.unpackedBytes)fail('RESOURCE_LIMIT','导出内容超过限制')
    const sha256=await fileHash(file);if(fileIdentity(await lstat(file))!==record.identity)fail('SOURCE_CHANGED','读取期间文件发生变化')
    files.push({...record,type:'file',size:s.size,sha256})
   }else if(s.isSymbolicLink()){
    const link=await readlink(file),target=await realpath(file).catch(()=>null),lexical=path.resolve(path.dirname(file),link)
    if(path.isAbsolute(link)||link.includes('\\')||!target?.startsWith(root+path.sep)||!lexical.startsWith(root+path.sep))fail('NONPORTABLE_DEPENDENCY',`资源链接位于包外：${rel}`)
    files.push({...record,type:'symlink',link})
   }else fail('UNSAFE_PATH','导出包含特殊文件')
  }
 }
 await visit(root);return files
}
export async function collectExportGraph({source,host,signal,limits={}}){
 const cap={...LIMITS,...limits},nodes=[],warnings=[],exclusions=[],budget={entries:0,bytes:0}
 async function visit(root,ancestors=[],depth=0){
  checkExportAbort(signal);root=await realpath(root)
  if(ancestors.includes(root))fail('DEPENDENCY_CYCLE_UNSUPPORTED','依赖存在环，首版暂不能可靠导出')
  if(depth>cap.maxDepth)fail('RESOURCE_LIMIT','依赖层级过深')
  const manifest=await readJson(path.join(root,'package.json'))
  if(!validPackageName(manifest.name)||!semver.valid(manifest.version))fail('INVALID_PACKAGE_IDENTITY','运行依赖缺少有效包名或版本')
  if(depth===0&&(source.name&&manifest.name!==source.name||source.version&&manifest.version!==source.version))fail('SOURCE_CHANGED','插件身份在收集前发生变化，请刷新重试')
  const node={id:nodes.length,root,manifest,dependencies:{},optionalDependencies:{},hostPeers:{}}
  nodes.push(node)
  node.files=await listExportFiles(root,{budget,limits:cap,signal,exclusions,nodeId:node.id})
  node.fingerprint=digest(JSON.stringify(node.files))
  for(const [name,spec]of Object.entries({...manifest.dependencies,...manifest.optionalDependencies})){
   if(!validPackageName(name))fail('INVALID_PACKAGE_NAME','依赖包名无效')
   const optional=Object.hasOwn(manifest.optionalDependencies??{},name),identity=dependencyIdentity(name,spec)
   if(isHostPackage(identity.name)){
    if(!semver.satisfies(host.version,identity.range,{includePrerelease:true}))fail('HOST_INCOMPATIBLE',`宿主模块版本不符：${name}`)
    node.hostPeers[name]=identity.range;continue
   }
   const location=await installedDependency(root,name)
   if(!location){if(optional){warnings.push({code:'OPTIONAL_DEPENDENCY_ABSENT',message:`源机没有可选依赖 ${name}`});continue}fail('MISSING_DEPENDENCY',`缺少运行依赖 ${name}`)}
   if([...ancestors,root].includes(location))fail('DEPENDENCY_CYCLE_UNSUPPORTED','依赖存在环，首版暂不能可靠导出')
   const info=await readJson(path.join(location,'package.json'))
   const local=/^(?:file:|link:|workspace:|git(?:\+|:)|https?:|github:|gitlab:|bitbucket:)/.test(String(identity.range))
   if(info.name!==identity.name||!semver.valid(info.version)||!local&&(!semver.validRange(identity.range)||!semver.satisfies(info.version,identity.range,{includePrerelease:true})))fail('DEPENDENCY_VERSION_MISMATCH',`运行依赖身份或版本不符：${name}`)
   const child=await visit(location,[...ancestors,root],depth+1)
   node[optional?'optionalDependencies':'dependencies'][name]={nodeId:child.id,version:info.version,spec:identity.alias?`npm:${identity.name}@${info.version}`:info.version}
  }
  for(const [name,range]of Object.entries(manifest.peerDependencies??{})){
   const version=await exportedPeerVersion(host,name),optional=manifest.peerDependenciesMeta?.[name]?.optional
   if(!version){if(optional){warnings.push({code:'OPTIONAL_PEER_UNCONFIRMED',message:`可选宿主依赖未确认：${name}`});continue}fail('PEER_UNCONFIRMED',`无法确认由宿主提供的共享依赖 ${name}`)}
   if(!semver.satisfies(version,range,{includePrerelease:true}))fail('HOST_INCOMPATIBLE',`宿主共享依赖版本不符：${name}`)
   node.hostPeers[name]=range
  }
  return node
 }
 const root=await visit(source.root)
 return {nodes,rootId:root.id,warnings,exclusions,source,sourceEnvironment:{dsh:host.version,target:host.target,runtime:host.runtime},budget,limits:cap}
}
