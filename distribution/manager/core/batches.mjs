import path from 'node:path'
import {randomUUID} from 'node:crypto'
import {atomicJson,readJson,fileHash,digest} from './files.mjs'
import {checkedId,withManagerLock,readOperation,saveOperation} from './receipts.mjs'
import {profileFingerprint} from './snapshots.mjs'
import {createOperationPlan} from './plans.mjs'
import {executePlan} from './operations.mjs'
import {LIMITS,fail} from '../contracts/constants.mjs'
const batchFile=(root,id)=>path.join(root,'batches',checkedId(id)+'.json')
const identity=h=>digest(JSON.stringify({hostId:h.hostId,profileDir:h.profileDir,dshRoot:h.dshRoot,nodePath:h.nodePath,version:h.version,runtime:h.runtime}))
export async function createBatch({host,inspections,acceptUnverified=false,ownerId,storeDir}){
 if(!Array.isArray(inspections)||!inspections.length||inspections.length>LIMITS.maxItems||new Set(inspections.map(i=>i.packageName)).size!==inspections.length)fail('INVALID_BATCH','每批 1—20 个不同插件')
 if(!acceptUnverified&&inspections.some(i=>i.warnings?.length))fail('RISK_CONFIRMATION_REQUIRED','请先确认本批未验证条件')
 const items=[];for(const inspection of inspections){const p=await createOperationPlan({host,inspection,action:'install',acceptUnverified});items.push({inspection,sha256:p.packageSha256})}
 const batch={schemaVersion:1,batchId:randomUUID(),hostId:host.hostId,ownerId,hostIdentity:identity(host),beforeFingerprint:await profileFingerprint(host.profileDir),items,expiresAt:Date.now()+LIMITS.planTtlMs,acceptedAt:null,next:0,results:[],activePlan:null}
 await atomicJson(batchFile(storeDir,batch.batchId),batch)
 return{batchId:batch.batchId,hostId:batch.hostId,expiresAt:batch.expiresAt,items:items.map(({inspection:i})=>({packageName:i.packageName,version:i.version,sha256:i.sha256,warnings:i.warnings})),requiresExit:host.capabilities.requiresExit!==false}
}
export async function startBatch(id,{host,storeDir}){
 return withManagerLock(storeDir,host.hostId,async()=>{
  const b=await readJson(batchFile(storeDir,id));if(b.hostId!==host.hostId||b.hostIdentity!==identity(host))fail('HOST_CHANGED','批次环境已变化')
  if(b.acceptedAt)return readOperation(id,{storeDir})
  if(Date.now()>=b.expiresAt)fail('PLAN_EXPIRED','批次预览已过期')
  if(await profileFingerprint(host.profileDir)!==b.beforeFingerprint)fail('HOST_CHANGED','批次预览后配置已变化')
  for(const {inspection,sha256}of b.items)if(await fileHash(inspection.archivePath)!==sha256)fail('ARTIFACT_CHANGED','批次中有包已改变')
  b.acceptedAt=Date.now();b.expectedFingerprint=b.beforeFingerprint;await atomicJson(batchFile(storeDir,id),b)
  const op={schemaVersion:1,operationId:id,planId:id,hostId:host.hostId,batched:true,state:'waiting_for_host_exit',createdAt:Date.now(),plan:{ownerId:b.ownerId,packageName:`批量安装（${b.items.length} 项）`},result:{batch:true,items:[]},eventCursor:1};await saveOperation(op,{storeDir});return op
 })
}
export async function resumeBatch(id,{host,adapter,storeDir,quiesced=false,refreshHost=async()=>host,signal}){
 return withManagerLock(storeDir,'batch-'+checkedId(id),async()=>{
  const b=await readJson(batchFile(storeDir,id));if(!b.acceptedAt)fail('BATCH_NOT_CONFIRMED','请先确认批次')
  const aggregate=await readOperation(id,{storeDir});if(!quiesced)return aggregate
  if(b.recoveryOperationId){const r=await readOperation(b.recoveryOperationId,{storeDir});if(r.state!=='failed_restored'||!r.result?.restored)return aggregate;b.expectedFingerprint=r.plan.beforeState.fingerprint;delete b.recoveryOperationId}
  aggregate.state='waiting_for_host_exit';await saveOperation(aggregate,{storeDir})
  while(b.next<b.items.length){
   if(signal?.aborted)break
   host=await refreshHost();if(b.hostIdentity!==identity(host))fail('HOST_CHANGED','目标宿主运行时或目录已变化')
   if(!b.activePlan){
    if(await profileFingerprint(host.profileDir)!==b.expectedFingerprint)fail('HOST_CHANGED','批次之间存在外部修改，请重新检查剩余项目')
    const inspection=b.items[b.next].inspection
    const p=await createOperationPlan({host,inspection,action:'install',acceptUnverified:true});if(p.beforeState.fingerprint!==b.expectedFingerprint)fail('HOST_CHANGED','批次配置已变化')
    p.ownerId=b.ownerId;b.activePlan=p;await atomicJson(batchFile(storeDir,id),b)
   }
   const op=await executePlan(b.activePlan,{host,adapter,storeDir,quiesced,signal,accepted:true})
   if(!['awaiting_reload','succeeded','failed_restored','cancelled'].includes(op.state)){b.recoveryOperationId=op.operationId;aggregate.state='recovery_required';aggregate.result.items=[...b.results,{operationId:op.operationId,packageName:b.activePlan.packageName,state:op.state}];await atomicJson(batchFile(storeDir,id),b);await saveOperation(aggregate,{storeDir});return aggregate}
   const expected=op.state==='failed_restored'||op.state==='cancelled'?b.activePlan.beforeState.fingerprint:op.afterFingerprint
   if(await profileFingerprint(host.profileDir)!==expected)fail('HOST_CHANGED','本项结束后配置发生外部修改')
   b.results.push({operationId:op.operationId,packageName:b.activePlan.packageName,state:op.state,error:op.error});b.expectedFingerprint=expected;b.activePlan=null;b.next++
   await atomicJson(batchFile(storeDir,id),b)
  }
  aggregate.state=b.results.some(r=>r.state==='awaiting_reload')?'awaiting_reload':'succeeded';aggregate.result={batch:true,items:b.results,partialFailure:b.results.some(r=>r.state==='failed_restored'),packageName:`批量安装（${b.items.length} 项）`};aggregate.updatedAt=Date.now();await saveOperation(aggregate,{storeDir});return aggregate
 })
}
