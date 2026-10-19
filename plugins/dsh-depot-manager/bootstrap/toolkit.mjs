import path from 'node:path'
import {readFile,realpath,mkdir,cp,rename,rm} from 'node:fs/promises'
import {randomUUID} from 'node:crypto'
import {fileHash,readJson,atomicJson,digest} from '../core/files.mjs'
import {runtimeTarget} from '@dsh-depot/offline-format/platform'
import {resolveRuntime} from './runtime.mjs'
import {fail,MANAGER_VERSION} from '../contracts/constants.mjs'
export async function verifyBundle(root,{target=runtimeTarget(process.platform,process.arch)}={}){
 const bundle=await readJson(path.join(root,'bundle.json'))
 if(bundle.schemaVersion!==1||bundle.target!==target||!['full','lite'].includes(bundle.flavor)||bundle.version!==MANAGER_VERSION)fail('BUNDLE_IDENTITY_MISMATCH','安装器版本、平台或类型不符')
 const rows=(await readFile(path.join(root,'payload.sha256'),'utf8')).trim().split(/\r?\n/).map(line=>line.match(/^([a-f0-9]{64})  (core\.mjs|manager\.tgz|bundle\.json)$/))
 if(rows.length!==3||rows.some(x=>!x)||new Set(rows.map(x=>x[2])).size!==3)fail('BUNDLE_INVENTORY_INVALID','安装器文件清单无效')
 for(const row of rows)if(await fileHash(path.join(root,row[2]))!==row[1])fail('BUNDLE_HASH_MISMATCH','安装器文件校验失败：'+row[2])
 for(const [file,sha256]of Object.entries(bundle.entryHashes??{})){if(!['install.sh','install.command','install.cmd','install.ps1'].includes(file)||await fileHash(path.join(root,file))!==sha256)fail('BUNDLE_HASH_MISMATCH','脚本入口校验失败')}
 if(!Object.keys(bundle.entryHashes??{}).length)fail('BUNDLE_INVENTORY_INVALID','缺少入口摘要')
 if(await fileHash(path.join(root,'manager.tgz'))!==bundle.managerSha256)fail('BUNDLE_HASH_MISMATCH','随包管理器校验失败')
 return {...bundle,root,bundleDigest:digest(rows.map(x=>x[0]+' '+x[2]).join('\n'))}
}
export async function prepareToolkit({root,storeDir,profileDir,target,nodePath=process.execPath}){
 const bundle=await verifyBundle(root,{target}),runtime=await resolveRuntime({bundle,nodePath})
 const destination=path.join(storeDir,'toolkits',MANAGER_VERSION+'-'+bundle.bundleDigest.slice(0,16))
 if(profileDir){const profile=await realpath(profileDir);if(destination===profile||destination.startsWith(profile+path.sep))fail('TOOLKIT_LOCATION','工具必须位于插件配置之外')}
 if(path.resolve(root)!==path.resolve(destination)){
  const temporary=destination+'.'+randomUUID()+'.tmp';await mkdir(path.dirname(destination),{recursive:true,mode:0o700})
  try{await mkdir(temporary,{mode:0o700});for(const file of ['core.mjs','manager.tgz','bundle.json','payload.sha256','README.txt',...Object.keys(bundle.entryHashes),...(bundle.flavor==='full'?['runtime']:[])])await cp(path.join(root,file),path.join(temporary,file),{recursive:true,dereference:false});await verifyBundle(temporary,{target});try{await rename(temporary,destination)}catch(e){if(!['EEXIST','ENOTEMPTY'].includes(e.code))throw e;await verifyBundle(destination,{target})}}finally{await rm(temporary,{recursive:true,force:true})}
 }
 const toolkit={...runtime,root:destination,bundleDigest:bundle.bundleDigest,nodePath:bundle.flavor==='full'?path.join(destination,'runtime',process.platform==='win32'?'node.exe':'node'):runtime.nodePath,entryPath:path.join(destination,process.platform==='win32'?'install.cmd':process.platform==='darwin'?'install.command':'install.sh')}
 await atomicJson(path.join(storeDir,'toolkit.json'),toolkit);return toolkit
}
export async function registeredToolkit(storeDir){try{const toolkit=await readJson(path.join(storeDir,'toolkit.json'));await verifyBundle(toolkit.root);if(await fileHash(toolkit.nodePath)!==toolkit.nodeFingerprint)return null;return toolkit}catch{return null}}
