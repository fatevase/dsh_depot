import path from 'node:path'
import {mkdir,lstat,readlink,symlink,chmod,rm,stat,realpath} from 'node:fs/promises'
import {createReadStream,createWriteStream} from 'node:fs'
import {pipeline} from 'node:stream/promises'
import * as tar from 'tar'
import {listExportFiles,fileIdentity,checkExportAbort,installedDependency} from './export-dependencies.mjs'
import {atomicJson,fileHash,readJson,auditTree,digest} from './files.mjs'
import {writePackageMetadata} from './package-metadata.mjs'
import {inspectArtifact} from './inspect.mjs'
import {fail} from '../contracts/constants.mjs'
const installHooks=new Set(['preinstall','install','postinstall','prepare','prepublish','prepublishOnly','postpublish','prepack','postpack'])
async function unchanged(graph,signal){
 for(const node of graph.nodes){
  const files=await listExportFiles(node.root,{budget:{entries:0,bytes:0},limits:graph.limits,signal})
  if(digest(JSON.stringify(files))!==node.fingerprint)fail('SOURCE_CHANGED','导出期间源文件发生变化，请稍后重试')
  for(const [name,edge]of Object.entries({...node.dependencies,...node.optionalDependencies}))if(await installedDependency(node.root,name)!==graph.nodes[edge.nodeId].root)fail('SOURCE_CHANGED','运行依赖位置发生变化')
 }
}
export async function exportInstalledPackage({graph,host,workDir,signal,onProgress=()=>{}}){
 await mkdir(workDir,{recursive:true,mode:0o700});const root=path.join(workDir,'staging/package');await mkdir(root,{recursive:true,mode:0o700})
 let copied=0
 const progress=stage=>onProgress({stage,files:copied,totalFiles:graph.budget.entries,unpackedBytes:graph.budget.bytes})
 try{
  await unchanged(graph,signal);progress('collecting')
  async function copyNode(id,dest){
   const node=graph.nodes[id];await mkdir(dest,{recursive:true,mode:0o700})
   for(const item of node.files){
    checkExportAbort(signal);const from=path.join(node.root,item.path),to=path.join(dest,item.path)
    if(fileIdentity(await lstat(from))!==item.identity)fail('SOURCE_CHANGED','复制期间源文件发生变化')
    if(item.type==='directory')await mkdir(to,{recursive:true,mode:0o755})
    else if(item.type==='symlink'){if(await readlink(from)!==item.link)fail('SOURCE_CHANGED','资源链接发生变化');await symlink(item.link,to)}
    else {await pipeline(createReadStream(from),createWriteStream(to,{mode:item.mode,flags:'wx'}),{signal});await chmod(to,item.mode);if(await fileHash(to)!==item.sha256||fileIdentity(await lstat(from))!==item.identity)fail('SOURCE_CHANGED','复制期间源文件发生变化')}
    copied++;if(copied%100===0)progress('collecting')
   }
   const p=structuredClone(node.manifest);delete p.devDependencies;delete p.bundledDependencies;delete p.bundleDependencies
   p.dependencies=Object.fromEntries(Object.entries(node.dependencies).map(([n,e])=>[n,e.spec]));p.optionalDependencies=Object.fromEntries(Object.entries(node.optionalDependencies).map(([n,e])=>[n,e.spec]))
   p.bundleDependencies=Object.keys({...p.dependencies,...p.optionalDependencies});p.peerDependencies={...p.peerDependencies,...node.hostPeers}
   if(p.scripts)p.scripts=Object.fromEntries(Object.entries(p.scripts).filter(([name])=>!installHooks.has(name)))
   await atomicJson(path.join(dest,'package.json'),p)
   for(const [name,edge]of Object.entries({...node.dependencies,...node.optionalDependencies}))await copyNode(edge.nodeId,path.join(dest,'node_modules',name))
  }
  await copyNode(graph.rootId,root);checkExportAbort(signal)
  const files=await auditTree(root,{limits:graph.limits}),native=files.some(f=>/\.(node|dll|dylib|so)(?:\.|$)/.test(f.path)),p=await readJson(path.join(root,'package.json'))
  progress('packing')
  const source={type:'local-export',environment:graph.sourceEnvironment,exclusions:graph.exclusions,warnings:graph.warnings}
  const nativeConstraints=native?{nodeAbi:String(host.runtime.abi),runtimeKinds:[host.runtime.kind],...(host.runtime.libc?{libc:{name:host.runtime.libc.name,minimumVersion:host.runtime.libc.version}}:{})}:{}
  await writePackageMetadata(root,{task:{target:host.target,host:{version:host.version,node:host.runtime.node},testedEnvironments:[],source,buildKey:digest(JSON.stringify(files))},recipe:{id:'local-export',hostRange:host.version,nativeConstraints,probes:{}}})
  await auditTree(root,{limits:graph.limits});checkExportAbort(signal)
  const fileName=`${p.name.replace(/^@/,'').replaceAll('/','-')}-${p.version}-${host.target}.tgz`,archive=path.join(workDir,fileName)
  // Streaming output enforces the compressed budget before an oversized archive fills disk.
  let bytes=0;const output=createWriteStream(archive,{mode:0o600,flags:'wx'}),pack=tar.c({gzip:true,cwd:path.dirname(root),portable:true},['package'])
  pack.on('data',chunk=>{bytes+=chunk.length;if(bytes>graph.limits.compressedBytes)pack.destroy(Object.assign(new Error('压缩包超过限制'),{code:'RESOURCE_LIMIT'}))})
  await pipeline(pack,output,{signal});checkExportAbort(signal);progress('checking')
  const inspection=await inspectArtifact({path:archive,host,workDir:path.join(workDir,'inspection'),limits:graph.limits})
  await unchanged(graph,signal);checkExportAbort(signal)
  return {fileName,path:archive,sha256:await fileHash(archive),compressedBytes:(await stat(archive)).size,inspection,warnings:[...graph.warnings,...inspection.warnings]}
 }finally{await rm(path.join(workDir,'staging'),{recursive:true,force:true});await rm(path.join(workDir,'inspection'),{recursive:true,force:true})}
}
