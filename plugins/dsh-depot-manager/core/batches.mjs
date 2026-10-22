import path from 'node:path'
import {randomUUID} from 'node:crypto'
import {atomicJson,readJson,fileHash,digest} from './files.mjs'
import {checkedId,withManagerLock,readOperation,saveOperation,operationsIn} from './receipts.mjs'
import {profileFingerprint,configurationFingerprint} from './snapshots.mjs'
import {createOperationPlan} from './plans.mjs'
import {executePlan} from './operations.mjs'
import {LIMITS,fail} from '../contracts/constants.mjs'
const batchFile=(root,id)=>path.join(root,'batches',checkedId(id)+'.json')
const fingerprint=(batch,dir)=>(batch.execution==='dsh-cli'?configurationFingerprint:profileFingerprint)(dir)
const identity=h=>digest(JSON.stringify({hostId:h.hostId,profileDir:h.profileDir,dshRoot:h.dshRoot,nodePath:h.nodePath,version:h.version,runtime:h.runtime}))
export async function createBatch({host,inspections,acceptUnverified=false,ownerId,storeDir,execution='dsh-cli'}){
 if(!Array.isArray(inspections)||!inspections.length||inspections.length>LIMITS.maxItems||new Set(inspections.map(i=>i.packageName)).size!==inspections.length)fail('INVALID_BATCH','每批 1—20 个不同插件')
 if(!acceptUnverified&&inspections.some(i=>i.warnings?.length))fail('RISK_CONFIRMATION_REQUIRED','请先确认本批未验证条件')
 const items=[];for(const inspection of inspections){const p=await createOperationPlan({host,inspection,action:'install',acceptUnverified,execution});items.push({inspection,sha256:p.packageSha256})}
 const batch={schemaVersion:1,execution,batchId:randomUUID(),hostId:host.hostId,ownerId,hostIdentity:identity(host),beforeFingerprint:await fingerprint({execution},host.profileDir),items,expiresAt:Date.now()+LIMITS.planTtlMs,acceptedAt:null,next:0,results:[],activePlan:null}
 await atomicJson(batchFile(storeDir,batch.batchId),batch)
 return{batchId:batch.batchId,hostId:batch.hostId,expiresAt:batch.expiresAt,items:items.map(({inspection:i})=>({packageName:i.packageName,version:i.version,sha256:i.sha256,warnings:i.warnings})),requiresExit:execution==='snapshot'||host.desktop?.layout==='bundled-cli'}
}
export async function startBatch(id,{host,storeDir}){
 return withManagerLock(storeDir,host.hostId,async()=>{
  const b=await readJson(batchFile(storeDir,id));if(b.hostId!==host.hostId||b.hostIdentity!==identity(host))fail('HOST_CHANGED','批次环境已变化')
  if(b.acceptedAt)return readOperation(id,{storeDir})
  if(Date.now()>=b.expiresAt)fail('PLAN_EXPIRED','批次预览已过期')
  if(await fingerprint(b,host.profileDir)!==b.beforeFingerprint)fail('HOST_CHANGED','批次预览后配置已变化')
  for(const {inspection,sha256}of b.items)if(await fileHash(inspection.archivePath)!==sha256)fail('ARTIFACT_CHANGED','批次中有包已改变')
  b.acceptedAt=Date.now();b.expectedFingerprint=b.beforeFingerprint;await atomicJson(batchFile(storeDir,id),b)
  const op={schemaVersion:1,operationId:id,planId:id,hostId:host.hostId,batched:true,state:b.execution==='dsh-cli'?'queued':'waiting_for_host_exit',createdAt:Date.now(),plan:{execution:b.execution,ownerId:b.ownerId,packageName:`批量安装（${b.items.length} 项）`},result:{batch:true,items:[]},eventCursor:1};await saveOperation(op,{storeDir});return op
 })
}
export async function resumeBatch(id,{host,adapter,storeDir,quiesced=false,refreshHost=async()=>host,signal}){
 return withManagerLock(storeDir,'batch-'+checkedId(id),async()=>{
  const b=await readJson(batchFile(storeDir,id));if(!b.acceptedAt)fail('BATCH_NOT_CONFIRMED','请先确认批次')
  const aggregate=await readOperation(id,{storeDir});if(b.execution==='snapshot'&&!quiesced)return aggregate
  if(b.recoveryOperationId){const r=await readOperation(b.recoveryOperationId,{storeDir});if(r.state!=='failed_restored'||!r.result?.restored)return aggregate;b.expectedFingerprint=r.plan.beforeState.fingerprint;delete b.recoveryOperationId}
  if(b.execution===undefined){
   if(b.hostIdentity!==identity(host))fail('HOST_CHANGED','目标宿主运行时或目录已变化')
   const active=b.activePlan&&(await operationsIn(storeDir)).find(o=>o.planId===b.activePlan.planId)
   if(active&&['applying','checking_install','backing_up','recovering','recovery_required'].includes(active.state)){b.recoveryOperationId=active.operationId;aggregate.state='recovery_required';aggregate.result.items=[...b.results,{operationId:active.operationId,packageName:b.activePlan.packageName,state:active.state}];await atomicJson(batchFile(storeDir,id),b);await saveOperation(aggregate,{storeDir});return aggregate}
   const current=await configurationFingerprint(host.profileDir)
   if(active&&['succeeded','awaiting_reload','failed_restored','cancelled'].includes(active.state)){b.results.push({operationId:active.operationId,packageName:b.activePlan.packageName,state:active.state,error:active.error});b.next++;b.activePlan=null}
   if(b.activePlan)b.activePlan={...b.activePlan,execution:'dsh-cli',requiresExit:false,recoveryBytes:0,beforeState:{...b.activePlan.beforeState,fingerprint:current}}
   b.execution='dsh-cli';b.expectedFingerprint=current;aggregate.plan.execution='dsh-cli';await atomicJson(batchFile(storeDir,id),b)
  }
  aggregate.state='waiting_for_host_exit';await saveOperation(aggregate,{storeDir})
  while(b.next<b.items.length){
   if(signal?.aborted)break
   host=await refreshHost();if(b.hostIdentity!==identity(host))fail('HOST_CHANGED','目标宿主运行时或目录已变化')
   if(!b.activePlan){
    if(await fingerprint(b,host.profileDir)!==b.expectedFingerprint)fail('HOST_CHANGED','批次之间存在外部修改，请重新检查剩余项目')
    const inspection=b.items[b.next].inspection
    const p=await createOperationPlan({host,inspection,action:'install',acceptUnverified:true,execution:b.execution??'snapshot'});if(p.beforeState.fingerprint!==b.expectedFingerprint)fail('HOST_CHANGED','批次配置已变化')
    p.ownerId=b.ownerId;b.activePlan=p;await atomicJson(batchFile(storeDir,id),b)
   }
   const op=await executePlan(b.activePlan,{host,adapter,storeDir,quiesced,signal,accepted:true})
   if(op.state==='waiting_for_host_exit'){aggregate.state='waiting_for_host_exit';aggregate.result={batch:true,items:b.results};await atomicJson(batchFile(storeDir,id),b);await saveOperation(aggregate,{storeDir});return aggregate}
   if(b.execution==='dsh-cli'&&['applying','checking_install'].includes(op.state)){aggregate.state='failed';aggregate.result={batch:true,items:[...b.results,{operationId:op.operationId,packageName:b.activePlan.packageName,state:op.state}],partialFailure:true,remaining:b.items.length-b.next};aggregate.error={code:'INTERRUPTED',message:'子任务中断，请从恢复任务结束该子任务，再重新安装剩余成品'};await saveOperation(aggregate,{storeDir});return aggregate}
   if(op.state==='failed'){b.results.push({operationId:op.operationId,packageName:b.activePlan.packageName,state:op.state,error:op.error});b.activePlan=null;b.next++;aggregate.state='failed';aggregate.result={batch:true,items:b.results,partialFailure:true,remaining:b.items.length-b.next};await atomicJson(batchFile(storeDir,id),b);await saveOperation(aggregate,{storeDir});return aggregate}
   if(!['awaiting_reload','succeeded','failed_restored','cancelled'].includes(op.state)){b.recoveryOperationId=op.operationId;aggregate.state='recovery_required';aggregate.result.items=[...b.results,{operationId:op.operationId,packageName:b.activePlan.packageName,state:op.state}];await atomicJson(batchFile(storeDir,id),b);await saveOperation(aggregate,{storeDir});return aggregate}
   const expected=op.state==='failed_restored'||op.state==='cancelled'?b.activePlan.beforeState.fingerprint:op.afterFingerprint
   if(await fingerprint(b,host.profileDir)!==expected)fail('HOST_CHANGED','本项结束后配置发生外部修改')
   b.results.push({operationId:op.operationId,packageName:b.activePlan.packageName,state:op.state,error:op.error});b.expectedFingerprint=expected;b.activePlan=null;b.next++
   await atomicJson(batchFile(storeDir,id),b)
  }
  aggregate.state=b.results.some(r=>r.state==='awaiting_reload')?'awaiting_reload':'succeeded';aggregate.result={batch:true,items:b.results,partialFailure:b.results.some(r=>r.state==='failed_restored'),packageName:`批量安装（${b.items.length} 项）`};aggregate.updatedAt=Date.now();await saveOperation(aggregate,{storeDir});return aggregate
 })
}
