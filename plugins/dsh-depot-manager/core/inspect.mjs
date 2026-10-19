import {cp,mkdir,stat,realpath,readFile} from 'node:fs/promises'
import path from 'node:path'
import {randomUUID} from 'node:crypto'
import semver from 'semver'
import * as tar from 'tar'
import {extractSafeArchive} from './archive.mjs'
import {verifyPackageMetadata} from './package-metadata.mjs'
import {fileHash,auditTree,readJson,inside} from './files.mjs'
import {validPackageName} from '../contracts/validate.mjs'
import {fail,LIMITS} from '../contracts/constants.mjs'
async function dependencies(root,p,host,warnings){
 const visited=new Set()
 async function visit(dir,manifest){if(visited.has(dir))return;visited.add(dir)
  for(const [name,range]of Object.entries({...manifest.dependencies,...manifest.optionalDependencies})){
   if(!validPackageName(name))fail('INVALID_PACKAGE_NAME','依赖包名无效')
   if(name.startsWith('@deepseek-ai/'))fail('DUPLICATE_HOST_RUNTIME','宿主核心包必须由 host peer 提供')
   if(/^(?:file|link|workspace|git|https?):/.test(range))fail('NONPORTABLE_DEPENDENCY','依赖包含本地或远程引用')
   let current=dir,location;while(current.startsWith(root)){const candidate=path.join(current,'node_modules',name);try{const r=await realpath(candidate);if(!r.startsWith(root+path.sep))fail('NONPORTABLE_DEPENDENCY','依赖链接位于包外');location=r;break}catch(e){if(!['ENOENT','ENOTDIR'].includes(e.code))throw e}if(current===root)break;current=path.dirname(current)}
   if(!location){if(Object.hasOwn(manifest.optionalDependencies??{},name)){warnings.push({code:'OPTIONAL_DEPENDENCY_ABSENT',message:`缺少可选依赖 ${name}`});continue}fail('MISSING_DEPENDENCY',`缺少离线运行依赖 ${name}`)}
   const dep=await readJson(path.join(location,'package.json'));if(dep.name!==name||!semver.satisfies(dep.version,range,{includePrerelease:true}))fail('DEPENDENCY_VERSION_MISMATCH',`运行依赖版本不符：${name}`);await visit(location,dep)
  }
  for(const [name,range]of Object.entries(manifest.peerDependencies??{})){const provided=host?.providedPeers?.[name]??(name.startsWith('@deepseek-ai/')?host?.version:undefined);if(provided&&!semver.satisfies(provided,range,{includePrerelease:true}))fail('HOST_INCOMPATIBLE',`宿主 peer 不兼容：${name}`);if(!provided&&!manifest.peerDependenciesMeta?.[name]?.optional)warnings.push({code:'PEER_UNCONFIRMED',message:`尚未确认宿主 peer ${name}`})}
 }
 await visit(root,p)
}
export async function inspectArtifact({path:input,host,trustIndex={},workDir,limits={}}){
 const source=await realpath(input),info=await stat(source);if(info.isFile()&&info.size>(limits.compressedBytes??LIMITS.compressedBytes))fail('RESOURCE_LIMIT','压缩包过大')
 const importId=randomUUID();await mkdir(workDir,{recursive:true,mode:0o700});const staging=path.join(workDir,importId);await mkdir(staging,{mode:0o700});let root=path.join(staging,'package'),archive=input,directory=info.isDirectory()
 if(directory){let sourceRoot=source;if(!await stat(path.join(sourceRoot,'package.json')).catch(()=>null)&&await stat(path.join(sourceRoot,'package/package.json')).catch(()=>null))sourceRoot=path.join(sourceRoot,'package');await auditTree(sourceRoot,{limits});await cp(sourceRoot,root,{recursive:true,dereference:false,verbatimSymlinks:true});archive=path.join(staging,'import.tgz');await tar.c({file:archive,gzip:true,cwd:staging,portable:true},['package'])}
 else{archive=path.join(staging,'import.tgz');await cp(source,archive);await extractSafeArchive(archive,root,limits)}
 const sha256=await fileHash(archive),p=await readJson(path.join(root,'package.json'))
 if(!validPackageName(p.name)||!semver.valid(p.version))fail('INVALID_PACKAGE_IDENTITY','插件名称或版本无效')
 const permits=(values,value)=>!values||Array.isArray(values)&&!values.includes('!'+value)&&(values.every(x=>x.startsWith('!'))||values.includes(value))
 if(!permits(p.os,host?.runtime?.platform)||!permits(p.cpu,host?.runtime?.arch))fail('TARGET_MISMATCH','npm 系统或 CPU 约束与宿主不匹配')
 if(!p.dsh?.bundle?.patch)fail('NOT_DSH_BUNDLE','缺少 DSH 插件声明')
 await stat(inside(root,p.dsh.bundle.patch.replace(/^\.\//,''))).catch(()=>fail('MISSING_BUILD_OUTPUT','缺少插件配置或构建产物'))
 if(p.main)await stat(inside(root,p.main.replace(/^\.\//,''))).catch(()=>fail('MISSING_BUILD_OUTPUT','缺少已构建插件入口'))
 const warnings=[],metadata=await verifyPackageMetadata(root),trusted=!directory?trustIndex[sha256]:null,target=metadata?.target??trusted?.target??null
 if(target&&target!==host?.target)fail('TARGET_MISMATCH','离线包与宿主平台不匹配')
 if(metadata?.compatibility?.dshRange&&!semver.satisfies(host.version,metadata.compatibility.dshRange,{includePrerelease:true}))fail('HOST_INCOMPATIBLE','插件与 DSH 版本不兼容')
 const nodeRange=metadata?.compatibility?.nodeRange??p.engines?.node;if(nodeRange&&!semver.satisfies(host.runtime.node,nodeRange,{includePrerelease:true}))fail('NODE_INCOMPATIBLE','插件与宿主 Node 版本不兼容')
 if(metadata?.native?.present){const n=metadata.native;if(n.nodeAbi&&String(n.nodeAbi)!==String(host.runtime.abi))fail('NATIVE_ABI_MISMATCH','原生模块 ABI 不兼容');if(n.napiMinimum&&n.napiMinimum>host.runtime.napi)fail('NATIVE_ABI_MISMATCH','Node-API 版本不足');if(n.runtimeKinds&&!n.runtimeKinds.includes(host.runtime.kind))fail('NATIVE_RUNTIME_MISMATCH','原生运行时不匹配');if(n.libc&&(host.runtime.libc?.name!==n.libc.name||n.libc.minimumVersion&&(!host.runtime.libc?.version||semver.lt(semver.coerce(host.runtime.libc.version),semver.coerce(n.libc.minimumVersion)))))fail('LIBC_INCOMPATIBLE','Linux libc 不兼容');if(!n.nodeAbi&&!n.napiMinimum)warnings.push({code:'NATIVE_UNCONFIRMED',message:'原生运行时条件尚未确认'})}
 await dependencies(await realpath(root),p,host,warnings)
 const publication=!!trusted&&trusted.verification?.status==='passed';if(!publication)warnings.push({code:'UNVERIFIED_PACKAGE',message:'没有匹配当前字节的公开验证证据'});if(!metadata&&!trusted)warnings.push({code:'UNKNOWN_PLATFORM',message:'未提供可核实的平台清单'})
 return{schemaVersion:1,importId,packageName:p.name,version:p.version,sha256,target,checks:{integrity:!!metadata,publication,dependencies:true},warnings,blockers:[],contentRoot:root,archivePath:archive,unpackedBytes:(await auditTree(root)).reduce((n,f)=>n+(f.size??0),0),directory,metadata,manifest:p}
}
