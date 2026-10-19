import {build} from 'esbuild'
import {mkdtemp,mkdir,cp,writeFile,readFile,rm,stat} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import path from 'node:path'
import os from 'node:os'
import * as tar from 'tar'
import {fileHash,atomicJson} from './core/files.mjs'
import {runHostCommand} from './adapters/command.mjs'
import {fail,MANAGER_VERSION} from './contracts/constants.mjs'
const here=fileURLToPath(new URL('.',import.meta.url))
export async function buildBootstrap({target,flavor,managerArchive,output,runtimeLock,runtimeArchive}={}) {
 if(!['macos-arm64','linux-x64','win32-x64'].includes(target)||!['full','lite'].includes(flavor))fail('INVALID_BUNDLE','平台或安装包类型无效')
 const lock=runtimeLock??JSON.parse(await readFile(path.join(here,'runtime-lock.json'),'utf8'))
 const temp=await mkdtemp(path.join(os.tmpdir(),'depot-bootstrap-')),name=`dsh-depot-manager-${MANAGER_VERSION}-${target}-${flavor}`,root=path.join(temp,name)
 try {
  await mkdir(root);await mkdir(output,{recursive:true})
  await build({entryPoints:[path.join(here,'bootstrap/bootstrap.mjs')],outfile:path.join(root,'core.mjs'),bundle:true,platform:'node',format:'esm',target:'node22',banner:{js:'import {createRequire as __createRequire} from "node:module";const require=__createRequire(import.meta.url);'}})
  const scripts=target==='win32-x64'?['install.cmd','install.ps1']:target==='macos-arm64'?['install.sh','install.command']:['install.sh']
  for(const script of scripts)await cp(path.join(here,'bootstrap',script),path.join(root,script))
  await cp(managerArchive,path.join(root,'manager.tgz'))
  let runtimeDigest=null
  if(flavor==='full') {
   const record=lock.targets[target]
   if(!runtimeArchive)fail('RUNTIME_ARCHIVE_REQUIRED','构建完整包需提供已下载的官方 Node 归档')
   if(await fileHash(runtimeArchive)!==record.sha256)fail('RUNTIME_ARCHIVE_HASH','官方 Node 归档校验失败')
   const extraction=path.join(temp,'runtime-source');await mkdir(extraction)
   const command=target==='win32-x64'?{executable:process.platform==='win32'?'python':'python3',args:['-c','import zipfile,sys;zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])',runtimeArchive,extraction]}:{executable:'tar',args:['-xf',runtimeArchive,'-C',extraction]}
   const result=await runHostCommand({...command,cwd:temp});if(result.exitCode)fail('RUNTIME_EXTRACT_FAILED',result.stderr)
   const runtime=path.join(root,'runtime');await mkdir(runtime)
   const node=path.join(runtime,target==='win32-x64'?'node.exe':'node');await cp(path.join(extraction,record.archiveRoot,record.nodeEntry),node);await cp(path.join(extraction,record.archiveRoot,record.licenseEntry),path.join(runtime,'LICENSE'))
   runtimeDigest=await fileHash(node);await writeFile(path.join(runtime,'node.sha256'),runtimeDigest+'\n')
  }
  const managerSha256=await fileHash(managerArchive),entryHashes=Object.fromEntries(await Promise.all(scripts.map(async name=>[name,await fileHash(path.join(root,name))])))
  await atomicJson(path.join(root,'bundle.json'),{schemaVersion:1,target,flavor,version:MANAGER_VERSION,managerSha256,runtimeDigest,entryHashes,nodeRange:'^22.19.0 || >=24.0.0'})
  await writeFile(path.join(root,'payload.sha256'),(await Promise.all(['core.mjs','manager.tgz','bundle.json'].map(async name=>`${await fileHash(path.join(root,name))}  ${name}`))).join('\n')+'\n')
  await writeFile(path.join(root,'README.txt'),'DSH 离线插件管理器\n先解压，再运行本平台 install 入口。首次使用请明确选择本机 DSH 配置并退出宿主。\nLinux/SSH: sh install.sh\n完整包附带独立 Node；轻量包需要已有 Node。无需 sudo，不会下载依赖。\n')
  const fileName=name+'.tgz',archive=path.join(output,fileName);await tar.c({file:archive,gzip:true,cwd:temp,portable:true},[name])
  return{target,flavor,fileName,path:archive,sha256:await fileHash(archive),compressedBytes:(await stat(archive)).size,managerSha256,runtimeDigest}
 }finally{await rm(temp,{recursive:true,force:true})}
}
