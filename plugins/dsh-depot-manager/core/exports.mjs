import path from 'node:path'
import {Worker} from 'node:worker_threads'
import {randomUUID} from 'node:crypto'
import {createReadStream} from 'node:fs'
import {readdir,rm,stat} from 'node:fs/promises'
import {atomicJson,readJson,fileHash} from './files.mjs'
import {checkedId,withManagerLock} from './receipts.mjs'
import {resolveExportSource,bundleFingerprint} from './export-source.mjs'
import {fail} from '../contracts/constants.mjs'
const unfinished=new Set(['queued','collecting','packing','checking'])
const live=pid=>{try{process.kill(pid,0);return true}catch(e){return e.code!=='ESRCH'}}
export const publicExport=j=>({exportId:j.exportId,packageName:j.packageName,version:j.version,state:j.state,progress:j.progress,createdAt:j.createdAt,updatedAt:j.updatedAt,expiresAt:j.expiresAt,error:j.error??null,warnings:j.warnings??[],exclusions:j.exclusions??[],...(j.state==='ready'?{fileName:j.fileName,sha256:j.sha256,compressedBytes:j.compressedBytes,downloadUrl:`/api/depot/export-download?id=${j.exportId}`}:{})})
export function createExportService({host,ownerId,storeDir,listBundles,resolveBundleDir}){
 const root=path.join(storeDir,'exports'),leases=new Map();let active=null,disposed=false,pumping=false,timer=null,serial=Promise.resolve()
 const directory=id=>path.join(root,checkedId(id)),file=id=>path.join(directory(id),'job.json')
 const save=job=>{job.updatedAt=Date.now();return atomicJson(file(job.exportId),job)}
 const own=job=>{if(job.hostId!==host.hostId||job.ownerId!==ownerId)fail('FORBIDDEN','导出任务属于其他用户或环境');return job}
 async function all(){let names;try{names=await readdir(root)}catch(e){if(e.code==='ENOENT')return[];throw e}const jobs=[];for(const name of names){if(!/^[a-zA-Z0-9_-]{1,100}$/.test(name))continue;try{const j=await readJson(file(name));if(j.exportId===name&&j.hostId===host.hostId&&j.ownerId===ownerId)jobs.push(j)}catch(e){if(e.code!=='ENOENT')throw e}}return jobs.sort((a,b)=>a.createdAt-b.createdAt)}
 async function discardPayload(job){for(const name of await readdir(directory(job.exportId))){if(name!=='job.json')await rm(path.join(directory(job.exportId),name),{recursive:true,force:true})}}
 async function prune(now=Date.now()){
  for(const j of await all())if(j.state==='ready'&&j.expiresAt<=now&&!leases.has(j.exportId)){j.state='expired';await discardPayload(j);await save(j)}
  const terminal=(await all()).filter(j=>j.state!=='ready'&&!unfinished.has(j.state)&&!leases.has(j.exportId)).reverse()
  for(const j of terminal.slice(20))await rm(directory(j.exportId),{recursive:true,force:true})
 }
 const initialized=(async()=>{for(const j of await all())if(unfinished.has(j.state)&&(!j.pid||!live(j.pid))){j.state='failed';j.error={code:'EXPORT_INTERRUPTED',message:'DSH 在导出完成前退出，请重新导出'};await discardPayload(j);await save(j)}await prune()})()
 function enqueue(fn){const p=serial.then(fn);serial=p.catch(()=>{});return p}
 async function pump(){
  if(pumping||disposed)return;pumping=true
  try{
   await initialized
   for(;;){
    if(disposed)break
    const job=(await all()).find(j=>j.state==='queued'&&j.pid===process.pid);if(!job)break
    try{
     await withManagerLock(storeDir,host.hostId,async()=>{
      if(disposed)return
      const current=own(await readJson(file(job.exportId)));if(current.state!=='queued')return
      const bundle=(await listBundles()).find(b=>b.name===job.packageName)
      if(!bundle||bundleFingerprint(bundle)!==job.installedFingerprint)fail('SOURCE_CHANGED','插件列表发生变化，请刷新后重新导出')
      const source=await resolveExportSource({host,bundle,resolveBundleDir})
      if(disposed||(await readJson(file(job.exportId))).state!=='queued')return
      await enqueue(async()=>{const j=await readJson(file(job.exportId));if(j.state==='queued'){j.state='collecting';await save(j)}})
      if(disposed||(await readJson(file(job.exportId))).state!=='collecting')return
      await new Promise((resolve,reject)=>{
       const url=typeof __DEPOT_EXPORT_WORKER__==='string'?new URL(__DEPOT_EXPORT_WORKER__,import.meta.url):new URL('../worker/export.mjs',import.meta.url)
       const worker=new Worker(url,{workerData:{source,host,workDir:directory(job.exportId)},execArgv:[]});active={id:job.exportId,worker};let completed=false
       const settle=fn=>enqueue(async()=>{if(completed)return;completed=true;active=null;await fn();resolve()}).catch(reject)
       worker.on('message',message=>{
        if(message.type==='progress')enqueue(async()=>{const j=await readJson(file(job.exportId));if(!unfinished.has(j.state)||j.state==='queued'&&disposed)return;j.state=message.value.stage;j.progress=message.value;await save(j)}).catch(()=>{})
        else if(message.type==='ready')settle(async()=>{const j=await readJson(file(job.exportId));if(j.state==='cancelled'||disposed)return;const b=(await listBundles()).find(b=>b.name===j.packageName);if(!b||bundleFingerprint(b)!==j.installedFingerprint){j.state='failed';j.error={code:'SOURCE_CHANGED',message:'插件状态发生变化，请重新导出'};await discardPayload(j)}else{Object.assign(j,message.value,{state:'ready',expiresAt:Date.now()+86400000})}await save(j)})
        else if(message.type==='failed')settle(async()=>{const j=await readJson(file(job.exportId));if(j.state==='cancelled')return;j.state='failed';j.error=message.value;await discardPayload(j);await save(j)})
       })
       worker.once('error',e=>settle(async()=>{const j=await readJson(file(job.exportId));if(j.state==='cancelled')return;j.state='failed';j.error={code:'EXPORT_WORKER_FAILED',message:'后台导出未完成，请重试'};await discardPayload(j);await save(j)}))
       worker.once('exit',()=>settle(async()=>{const j=await readJson(file(job.exportId));if(unfinished.has(j.state)){j.state='failed';j.error={code:'EXPORT_INTERRUPTED',message:'后台导出中断，请重新导出'};await discardPayload(j);await save(j)}}))
      })
     })
    }catch(e){if(e.code==='OPERATION_BUSY'){timer=setTimeout(()=>pump().catch(()=>{}),1000);timer.unref();break}const j=await readJson(file(job.exportId));if(unfinished.has(j.state)){j.state='failed';j.error={code:e.code??'EXPORT_FAILED',message:e.name==='ManagerError'?e.message:'未能读取已安装插件'};await discardPayload(j);await save(j)}}
   }
  }finally{pumping=false}
 }
 const service={
  async create({packageName,installedFingerprint,...extra}){
   await initialized;return enqueue(async()=>{if(disposed)fail('EXPORT_STOPPED','管理器正在退出');if((await all()).filter(j=>unfinished.has(j.state)).length>=20)fail('RESOURCE_LIMIT','最多同时保留 20 个待完成导出');if(Object.keys(extra).length)fail('INVALID_REQUEST','导出只接受包名与已安装指纹')
   const bundle=(await listBundles()).find(b=>b.name===packageName)
   if(!bundle||bundleFingerprint(bundle)!==installedFingerprint)fail('HOST_CHANGED','插件状态已变化，请刷新列表')
   const source=await resolveExportSource({host,bundle,resolveBundleDir}),job={exportId:randomUUID(),hostId:host.hostId,ownerId,pid:process.pid,packageName:source.name,version:source.version,installedFingerprint,state:'queued',createdAt:Date.now(),updatedAt:Date.now()}
   await save(job);queueMicrotask(()=>pump().catch(()=>{}));return publicExport(job)})
  },
  async list(){await initialized;await prune();return(await all()).reverse().map(publicExport)},
  async status(id){await initialized;return publicExport(own(await readJson(file(id))))},
  async cancel(id){await initialized;return enqueue(async()=>{const j=own(await readJson(file(id)));if(unfinished.has(j.state)){j.state='cancelled';await save(j);if(active?.id===id)await active.worker.terminate();await discardPayload(j)}return publicExport(j)})},
  async openDownload(id){
   await initialized;const j=own(await readJson(file(id)));if(j.state!=='ready'||j.expiresAt<=Date.now())fail('EXPORT_NOT_READY','导出尚未完成或下载已过期')
   // Acquire before awaiting I/O so periodic pruning cannot remove an in-flight download.
   leases.set(id,(leases.get(id)??0)+1);let released=false
   const release=()=>{if(released)return;released=true;const n=leases.get(id)-1;if(n)leases.set(id,n);else leases.delete(id)}
   try{const archive=path.join(directory(id),j.fileName);if(path.basename(j.fileName)!==j.fileName||(await stat(archive)).size!==j.compressedBytes||await fileHash(archive)!==j.sha256)fail('INTEGRITY_MISMATCH','导出文件发生变化，请重新导出');const stream=createReadStream(archive);for(const event of ['close','end','error'])stream.once(event,release);return{stream,fileName:j.fileName,bytes:j.compressedBytes,release}}catch(e){release();throw e}
  },prune,
  async dispose(){if(disposed)return;disposed=true;clearTimeout(timer);await initialized;if(active)await service.cancel(active.id);await serial;for(const j of await all())if(unfinished.has(j.state)&&j.pid===process.pid){j.state='failed';j.error={code:'EXPORT_INTERRUPTED',message:'管理器已退出，请重新导出'};await discardPayload(j);await save(j)}}
 };return service
}
