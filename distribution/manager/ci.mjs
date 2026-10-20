import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {mkdir,readFile,writeFile,readdir} from 'node:fs/promises'
import {buildManager} from '../../plugins/dsh-depot-manager/build.mjs'
import {buildBootstrap} from '../../plugins/dsh-depot-manager/build-bootstrap.mjs'
import {verifyManager,qualifyManagerReport} from './verify.mjs'
import {verifyExportRoundTrip} from './export-roundtrip.mjs'
import {prepareHost} from '../lib/verify.mjs'
import {atomicJson,fileHash} from '@dsh-depot/offline-format/files'
import {fail} from '@dsh-depot/offline-format/constants'
import {isManagerDownload} from '@dsh-depot/offline-format/manager-qualification'
export function assembleManagerPublication(receipts,{channel='stable'}={}) {
 const assets=[],blocked=[],verificationRefs=[]
 for(const r of receipts){
  const verified=qualifyManagerReport(r.verification??{})
  if(channel==='preview'){
   const valid=['macos-arm64','linux-x64','win32-x64'].includes(r.target)&&r.manager&&r.manager.target===r.target&&/^[a-f0-9]{64}$/.test(r.manager.sha256??'')&&r.manager.sha256===verified.packageSha256&&!r.fixture&&r.assets?.length&&r.assets.every(a=>a.target===r.target&&['full','lite'].includes(a.flavor)&&/^[a-f0-9]{64}$/.test(a.sha256??'')&&a.managerSha256===r.manager.sha256)
   if(!valid){blocked.push({target:r.target,reason:'MANAGER_BYTES_REQUIRED'});continue}
   for(const a of [...r.assets,{...r.manager,flavor:'plugin'}])assets.push({...a,channel:'preview',verification:{...verified,status:verified.status==='failed'?'failed':'unverified',bundleSha256:a.sha256,validationLevel:'plugin-only'}})
   verificationRefs.push(r.verificationRef);continue
  }
  if(verified.status!=='passed'||!r.manager||r.manager.sha256!==verified.packageSha256||r.fixture||!r.assets?.length||!r.assets.every(a=>a.sha256&&a.managerSha256===verified.packageSha256&&a.verification?.bundleSha256===a.sha256&&a.verification?.packageSha256===a.managerSha256&&qualifyManagerReport(a.verification).status==='passed')){blocked.push({target:r.target,reason:'MANAGER_ACCEPTANCE_REQUIRED',missing:verified.missing});continue}
  assets.push(...r.assets,...(r.manager?[{...r.manager,flavor:'plugin',verification:{...verified,bundleSha256:r.manager.sha256}}]:[]));verificationRefs.push(r.verificationRef)
 }
 return{channel,assets,blocked,verificationRefs}
}
export function managerCatalogOf(publications,support) {
 return{schemaVersion:1,generatedAt:new Date().toISOString(),support,packages:publications.filter(p=>['full','lite'].includes(p.flavor)&&isManagerDownload(p)).map(p=>({version:p.version,target:p.target,flavor:p.flavor,channel:p.channel??'stable',reportUrl:p.reportUrl,checksumsUrl:p.checksumsUrl,pluginUrl:p.pluginUrl,fileName:p.fileName,packageUrl:p.packageUrl,sha256:p.sha256,compressedBytes:p.compressedBytes,requirements:p.flavor==='lite'?{node:'^22.19.0 || >=24.0.0'}:{node:'附带独立 Node 26.9.0'},verification:p.verification,testedHosts:p.testedHosts??[]}))}
}
export async function buildOnRunner({target,output}) {
 output=path.resolve(output);await mkdir(output,{recursive:true})
 const started=Date.now(),manager=await buildManager({target,output}),lock=JSON.parse(await readFile(new URL('../../plugins/dsh-depot-manager/runtime-lock.json',import.meta.url))),record=lock.targets[target]
 const runtimeFile=path.join(output,path.basename(new URL(record.url).pathname)),response=await fetch(record.url,{signal:AbortSignal.timeout(180000)})
 if(!response.ok)fail('RUNTIME_DOWNLOAD_FAILED','官方 Node 下载失败')
 const handle=await import('node:fs').then(fs=>fs.createWriteStream(runtimeFile));await import('node:stream/promises').then(({pipeline})=>pipeline(response.body,handle))
 if(await fileHash(runtimeFile)!==record.sha256)fail('RUNTIME_ARCHIVE_HASH','官方 Node 归档哈希不符')
 const assets=[];for(const flavor of ['full','lite'])assets.push(await buildBootstrap({target,flavor,managerArchive:manager.path,output,runtimeArchive:runtimeFile}))
 const host=await prepareHost({workDir:path.join(output,'stock-host')})
 const verification=await verifyManager({bundle:manager,host,workDir:path.join(output,'verification')})
 const localExport=await verifyExportRoundTrip({host,workDir:path.join(output,'export-roundtrip')})
 await atomicJson(path.join(output,'export-roundtrip.json'),localExport)
 if(localExport.status!=='passed')fail('LOCAL_EXPORT_MIGRATION_FAILED',localExport.error?.message??'本机导出迁移验收未通过')
 const receipt={schemaVersion:1,target,manager,assets,verification,localExport,verificationRef:'manager-verification.json',seconds:(Date.now()-started)/1000,platformEvidence:{os:process.platform,arch:process.arch,node:process.versions.node,ssh:'unverified',fedora:'unverified'}}
 await atomicJson(path.join(output,'receipt.json'),receipt);await writeFile(path.join(output,'SHA256SUMS'),[manager,...assets].map(a=>`${a.sha256}  ${a.fileName}`).join('\n')+'\n');return receipt
}
async function main(argv){
 const [command,target,output='.runtime/manager-ci']=argv
 if(command==='build')return buildOnRunner({target,output})
 if(command==='publication'){
  const root=path.resolve(target),receipts=[];for(const dir of await readdir(root)){try{const r=JSON.parse(await readFile(path.join(root,dir,'receipt.json')));if(r.manager)r.manager.path=path.join(root,dir,path.basename(r.manager.fileName));r.assets=r.assets?.map(a=>({...a,path:path.join(root,dir,path.basename(a.fileName))}));receipts.push(r)}catch(e){if(e.code!=='ENOENT')throw e}}
  const plan=assembleManagerPublication(receipts,{channel:output==='preview'?'preview':'stable'});await atomicJson(path.join(root,'publication.json'),plan)
  if(!plan.assets.length)fail('MANAGER_ACCEPTANCE_REQUIRED','暂无满足完整验收条件的管理器资产；只保留 Actions 测试产物')
  return plan
 }
 fail('INVALID_COMMAND','manager CI command must be build or publication')
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===path.resolve(process.argv[1]))main(process.argv.slice(2)).then(r=>console.log(JSON.stringify(r)),e=>{console.error(e.code??'MANAGER_CI_FAILED',e.message);process.exitCode=1})
