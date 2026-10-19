import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {mkdir,readFile,writeFile,readdir} from 'node:fs/promises'
import {buildManager} from './build.mjs'
import {buildBootstrap} from './build-bootstrap.mjs'
import {verifyManager,qualifyManagerReport} from './verify.mjs'
import {prepareHost} from '../lib/verify.mjs'
import {atomicJson,fileHash} from './core/files.mjs'
import {fail} from './contracts/constants.mjs'
export function assembleManagerPublication(receipts) {
 const assets=[],blocked=[],verificationRefs=[]
 for(const r of receipts){
  const verified=qualifyManagerReport(r.verification??{})
  if(verified.status!=='passed'||!r.manager||r.manager.sha256!==verified.packageSha256||r.fixture||!r.assets?.length||!r.assets.every(a=>a.sha256&&a.managerSha256===verified.packageSha256&&a.verification?.bundleSha256===a.sha256&&a.verification?.packageSha256===a.managerSha256&&qualifyManagerReport(a.verification).status==='passed')){blocked.push({target:r.target,reason:'MANAGER_ACCEPTANCE_REQUIRED',missing:verified.missing});continue}
  assets.push(...r.assets,...(r.manager?[{...r.manager,flavor:'plugin',verification:verified}]:[]));verificationRefs.push(r.verificationRef)
 }
 return{assets,blocked,verificationRefs}
}
export function managerCatalogOf(publications,support) {
 return{schemaVersion:1,generatedAt:new Date().toISOString(),support,packages:publications.filter(p=>['full','lite'].includes(p.flavor)&&['macos-arm64','linux-x64','win32-x64'].includes(p.target)&&qualifyManagerReport(p.verification??{}).status==='passed'&&p.verification.bundleSha256===p.sha256&&/^https:\/\/github\.com\/fatevase\/dsh_depot\/releases\/download\//.test(p.packageUrl??'')).map(p=>({target:p.target,flavor:p.flavor,fileName:p.fileName,packageUrl:p.packageUrl,sha256:p.sha256,compressedBytes:p.compressedBytes,requirements:p.flavor==='lite'?{node:'^22.19.0 || >=24.0.0'}:{node:'附带独立 Node 26.9.0'},verification:p.verification,testedHosts:p.testedHosts??[]}))}
}
export async function buildOnRunner({target,output}) {
 output=path.resolve(output);await mkdir(output,{recursive:true})
 const started=Date.now(),manager=await buildManager({target,output}),lock=JSON.parse(await readFile(new URL('./runtime-lock.json',import.meta.url))),record=lock.targets[target]
 const runtimeFile=path.join(output,path.basename(new URL(record.url).pathname)),response=await fetch(record.url,{signal:AbortSignal.timeout(180000)})
 if(!response.ok)fail('RUNTIME_DOWNLOAD_FAILED','官方 Node 下载失败')
 const handle=await import('node:fs').then(fs=>fs.createWriteStream(runtimeFile));await import('node:stream/promises').then(({pipeline})=>pipeline(response.body,handle))
 if(await fileHash(runtimeFile)!==record.sha256)fail('RUNTIME_ARCHIVE_HASH','官方 Node 归档哈希不符')
 const assets=[];for(const flavor of ['full','lite'])assets.push(await buildBootstrap({target,flavor,managerArchive:manager.path,output,runtimeArchive:runtimeFile}))
 const host=await prepareHost({workDir:path.join(output,'stock-host')})
 const verification=await verifyManager({bundle:manager,host,workDir:path.join(output,'verification')})
 const receipt={schemaVersion:1,target,manager,assets,verification,verificationRef:'manager-verification.json',seconds:(Date.now()-started)/1000,platformEvidence:{os:process.platform,arch:process.arch,node:process.versions.node,ssh:'unverified',fedora:'unverified'}}
 await atomicJson(path.join(output,'receipt.json'),receipt);await writeFile(path.join(output,'SHA256SUMS'),[manager,...assets].map(a=>`${a.sha256}  ${a.fileName}`).join('\n')+'\n');return receipt
}
async function main(argv){
 const [command,target,output='.runtime/manager-ci']=argv
 if(command==='build')return buildOnRunner({target,output})
 if(command==='publication'){
  const root=path.resolve(target),receipts=[];for(const dir of await readdir(root)){try{const r=JSON.parse(await readFile(path.join(root,dir,'receipt.json')));if(r.manager)r.manager.path=path.join(root,dir,path.basename(r.manager.fileName));r.assets=r.assets?.map(a=>({...a,path:path.join(root,dir,path.basename(a.fileName))}));receipts.push(r)}catch(e){if(e.code!=='ENOENT')throw e}}
  const plan=assembleManagerPublication(receipts);await atomicJson(path.join(root,'publication.json'),plan)
  if(!plan.assets.length)fail('MANAGER_ACCEPTANCE_REQUIRED','暂无满足完整验收条件的管理器资产；只保留 Actions 测试产物')
  return plan
 }
 fail('INVALID_COMMAND','manager CI command must be build or publication')
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===path.resolve(process.argv[1]))main(process.argv.slice(2)).then(r=>console.log(JSON.stringify(r)),e=>{console.error(e.code??'MANAGER_CI_FAILED',e.message);process.exitCode=1})
