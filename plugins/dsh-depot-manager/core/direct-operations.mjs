import path from 'node:path'
import {randomUUID} from 'node:crypto'
import {withManagerLock,operationsIn,saveOperation} from './receipts.mjs'
import {configurationFingerprint} from './snapshots.mjs'
import {fileHash,readJson,digest} from './files.mjs'
import {fail} from '../contracts/constants.mjs'
export async function executeDirectPlan(plan,{host,adapter,storeDir,signal,onEvent,onOutput,now=Date.now(),quiesced=false,accepted=false}={}){
 return withManagerLock(storeDir,host.hostId,async()=>{
  const old=await operationsIn(storeDir),same=old.find(o=>o.planId===plan.planId)
  if(same&&same.state!=='waiting_for_host_exit'&&same.state!=='queued')return same
  if(old.some(o=>['applying','checking_install','recovering','backing_up','recovery_required'].includes(o.state)))fail('RECOVERY_REQUIRED','请先查看未完成任务')
  if(!same&&!accepted&&now>=plan.expiresAt)fail('PLAN_EXPIRED','安装计划已过期')
  if(plan.hostId!==host.hostId||plan.hostFingerprint!==host.fingerprint||await configurationFingerprint(host.profileDir)!==plan.beforeState.fingerprint)fail('HOST_CHANGED','目标配置已变化，请重新检查')
  if(plan.action!=='remove'&&await fileHash(plan._inspection.archivePath)!==plan.packageSha256)fail('ARTIFACT_CHANGED','离线包已改变')
  const op=same??{schemaVersion:1,operationId:randomUUID(),hostId:host.hostId,planId:plan.planId,plan,state:'queued',eventCursor:0,snapshotId:null,result:null,error:null,createdAt:Date.now()}
  op.plan=plan
  const emit=async state=>{op.state=state;op.updatedAt=Date.now();op.eventCursor++;await saveOperation(op,{storeDir});onEvent?.({...op,plan:undefined})}
  if(signal?.aborted){await emit('cancelled');return op}
  try{
   await emit('applying')
   const result=await adapter.applyDirect(host,{action:plan.action,packageName:plan.packageName,version:plan.version,contentRoot:plan._inspection?.contentRoot,path:plan._inspection?.archivePath,storeDir:path.join(storeDir,'stores',op.operationId)},{signal,onOutput})
   await emit('checking_install')
   const manifest=await readJson(path.join(host.profileDir,'package.json'))
   if(plan.action==='remove'){if(Object.hasOwn(manifest.dependencies??{},plan.packageName))fail('REMOVE_NOT_APPLIED','插件声明仍存在')}
   else {const installed=await readJson(path.join(result?.packageDir??path.join(host.profileDir,'node_modules',plan.packageName),'package.json'),{});if(!Object.hasOwn(manifest.dependencies??{},plan.packageName)||installed.name!==plan.packageName||installed.version!==plan.version)fail('INSTALL_IDENTITY_MISMATCH','实际安装版本与安装包不一致')}
   op.afterFingerprint=await configurationFingerprint(host.profileDir)
   op.result={installed:plan.action!=='remove',removed:plan.action==='remove',loaded:false,packageName:plan.packageName,version:plan.version,logPath:result?.logPath}
   op.reloadNonce=randomUUID();op.activationNonceDigest=digest(op.reloadNonce)
   for(const prior of old.filter(o=>o.state==='awaiting_reload'&&o.plan?.packageName===plan.packageName)){prior.state='cancelled';prior.result={...prior.result,loaded:false,supersededBy:op.operationId};delete prior.activationNonce;delete prior.reloadNonce;await saveOperation(prior,{storeDir})}
   await emit(plan.action==='remove'?'succeeded':'awaiting_reload')
  }catch(e){if(e.code==='HOST_STILL_RUNNING'){op.error=null;op.result=null;await emit('waiting_for_host_exit');return op}op.error={code:e.code??'DSH_INSTALL_FAILED',message:e.message};op.result={installed:false,loaded:false,packageName:plan.packageName,rollback:false};op.afterFingerprint=await configurationFingerprint(host.profileDir).catch(()=>null);await emit('failed')}
  return op
 })
}
