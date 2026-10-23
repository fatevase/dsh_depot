export {runOfflinePackageCommand} from '../../adapters/dsh-cli.mjs'
import {depotDataHome} from '../../core/paths.mjs'
import path from 'node:path'
import os from 'node:os'
import {realpath,rm} from 'node:fs/promises'
import {registeredToolkit} from '../../bootstrap/toolkit.mjs'
import {atomicJson} from '../../core/files.mjs'
import {pruneRetention} from '../../core/retention.mjs'
import {probeHost} from '../../adapters/discover.mjs'
import {adapterFor} from '../../adapters/select.mjs'
import {desktopAt} from '../../adapters/locate.mjs'
import {createManagerApi} from './api.mjs'
import {liveInstallAdapter} from './live-install.mjs'
import {exportDownloadResponse} from './export-download.mjs'
import {uploadChunk} from './upload.mjs'
import {operationsIn,readOperation,saveOperation} from '../../core/receipts.mjs'
import {recordActivation} from './activation.mjs'
import {MANAGER_NAME,MANAGER_VERSION,fail} from '../../contracts/constants.mjs'
const hostStartedAt=Date.now()-process.uptime()*1000
export const name=MANAGER_NAME
export const inject=['profileContext','connection','pluginManager','webServer']
export async function currentEnvironment(ctx) {
 const p=ctx.profileContext
 if(!p?.dir||!p?.installAnchor)fail('HOST_CONTEXT_REQUIRED','缺少公开配置上下文')
 const root=path.dirname(await realpath(p.installAnchor)),desktop=process.versions.electron?await desktopAt(root):null
 const host=await probeHost({kind:desktop?'official-desktop':'cli-web',desktop,runtimeEnv:desktop?{ELECTRON_RUN_AS_NODE:'1'}:undefined,profileName:p.name,profileDir:p.dir,home:p.home,dshRoot:path.dirname(await realpath(p.installAnchor)),nodePath:process.execPath,packageManager:p.packageManager})
 const toolkit=await registeredToolkit(path.join(depotDataHome(),'manager'));host.capabilities.externalToolkit=!!toolkit;host.capabilities.toolkitEntry=toolkit?.entryPath??null;return host
}
export async function apply(ctx) {
 const host=await currentEnvironment(ctx),ownerId=host.ownerId,storeDir=path.join(depotDataHome(),'manager','hosts',host.hostId)
 await atomicJson(path.join(storeDir,'host-live.json'),{hostId:host.hostId,pid:process.pid,startedAt:Date.now()})
 await pruneRetention({storeDir,profileDir:host.profileDir,hostId:host.hostId}).catch(()=>{})
 const api=createManagerApi({host,ownerId,storeDir,adapter:liveInstallAdapter({profile:ctx.profileContext,pluginManager:ctx.pluginManager,fallback:adapterFor(host)}),listBundles:()=>ctx.pluginManager.listBundles()})
 const disposers=[]
 // The public Connection registry supplies Host/Origin admission and browser authentication.
 disposers.push(ctx.connection.fetch.register({path:'/api/depot/rpc',methods:['POST'],requestBody:'buffered',async fetch(request){
  try{const {method,input}=await request.json();return Response.json({ok:true,value:await api.invoke(method,input,ownerId)})}catch(e){return Response.json({ok:false,error:{code:e.code??'MANAGER_FAILED',message:e.message}},{status:e.code==='FORBIDDEN'?403:400})}
 }}))
 disposers.push(ctx.connection.fetch.register({path:'/api/depot/upload',methods:['POST'],requestBody:'streaming',async fetch(request){
  try{const url=new URL(request.url);let bytes=0;const chunks=[];for await(const chunk of request.body??[]){bytes+=chunk.length;if(bytes>262144)fail('UPLOAD_LIMIT','分块过大');chunks.push(chunk)}const result=await uploadChunk({importId:url.searchParams.get('id'),relative:url.searchParams.get('path'),offset:Number(url.searchParams.get('offset')),final:url.searchParams.get('final')==='1',bytes:Buffer.concat(chunks)},api.uploadContext);return Response.json({ok:true,value:result})}catch(e){return Response.json({ok:false,error:{code:e.code??'UPLOAD_FAILED',message:e.message}},{status:400})}
 }}))
 disposers.push(ctx.connection.fetch.register({path:'/api/depot/export-download',methods:['GET'],requestBody:'buffered',async fetch(request){try{return await exportDownloadResponse(request,api.exports)}catch(e){return Response.json({ok:false,error:{code:e.code??'DOWNLOAD_FAILED',message:e.code==='FORBIDDEN'?'无权下载此任务':'导出尚未完成、已过期或文件不可用'}},{status:e.code==='FORBIDDEN'?403:404})}}}))
 // Keep saved legacy links inside the official shell and its theme/navigation.
 disposers.push(ctx.connection.fetch.register({path:'/api/depot/manager',methods:['GET'],requestBody:'buffered',fetch(){return new Response(null,{status:302,headers:{location:'/?depot=manager','cache-control':'no-store'}})}}))
 let disposed=false
 const observe=async()=>{
  if(disposed)return
  const [ops,bundles,plugins]=await Promise.all([operationsIn(storeDir),ctx.pluginManager.listBundles(),ctx.pluginManager.listPlugins()])
  for(const batch of ops.filter(o=>o.batched&&o.state==='awaiting_reload')){const children=await Promise.all(batch.result.items.map(i=>readOperation(i.operationId,{storeDir})));batch.result.items=children.map((o,i)=>({...batch.result.items[i],state:o.state}));if(children.every(o=>['succeeded','failed_restored','cancelled'].includes(o.state)))batch.state='succeeded';await saveOperation(batch,{storeDir})}
  for(const op of ops.filter(o=>o.state==='awaiting_reload'&&(o.reloadNonce||o.activationNonce))){
   const b=bundles.find(b=>b.name===op.result.packageName)
   const active=b?.rows?.length>0&&b.rows.every(row=>plugins.some(p=>p.entryId===row.entryId&&p.fiberPhase==='active'))
   if(active)await recordActivation({operationId:op.operationId,nonce:op.reloadNonce??op.activationNonce,hostId:host.hostId,version:b.version},{storeDir,observed:{name:b.name,version:b.version,active,hostStartedAt}}).catch(()=>{})
  }
 }
 const timer=setInterval(()=>{observe().catch(()=>{})},2000);timer.unref();await observe().catch(()=>{})
 const dispose=async()=>{disposed=true;clearInterval(timer);await api.dispose();await rm(path.join(storeDir,'host-live.json'),{force:true});for(const d of disposers.reverse())await d()}
 ctx.on('dispose',dispose);return dispose
}
