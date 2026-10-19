import {executeDirectPlan} from './direct-operations.mjs'
import {randomUUID} from 'node:crypto'
import path from 'node:path'
import {validatePlan} from '../contracts/validate.mjs'
import {fail} from '../contracts/constants.mjs'
import {fileHash,readJson,atomicJson,digest} from './files.mjs'
import {profileFingerprint,configurationFingerprint,snapshotProfile,restoreProfile,unrelatedManifestChanged,configFingerprints,profileRecords} from './snapshots.mjs'
import {withManagerLock,readOperation,saveOperation,operationsIn} from './receipts.mjs'
export {readOperation} from './receipts.mjs'
export async function executePlan(plan,{host,adapter,storeDir,signal,onEvent,now=Date.now(),quiesced=false,accepted=false,onOutput}={}){
 validatePlan(plan)
 if(plan.execution===undefined){if(plan.hostId!==host.hostId||plan.hostFingerprint!==host.fingerprint)fail('HOST_CHANGED','目标配置已变化，请重新检查');plan={...plan,execution:'dsh-cli',recoveryBytes:0,beforeState:{...plan.beforeState,fingerprint:await configurationFingerprint(host.profileDir)}}}
 if(plan.execution==='dsh-cli')return executeDirectPlan(plan,{host,adapter,storeDir,signal,onEvent,onOutput,now,quiesced,accepted})
 return withManagerLock(storeDir,host.hostId,async()=>{
  const old=await operationsIn(storeDir),same=old.find(o=>o.planId===plan.planId);if(same&&!(quiesced&&same.state==='waiting_for_host_exit'))return same
  if(old.some(o=>o.hostId===host.hostId&&['recovery_required','applying','recovering','backing_up','checking_install'].includes(o.state)))fail('RECOVERY_REQUIRED','先检查并恢复未完成任务')
  if(!same&&!accepted&&now>=plan.expiresAt)fail('PLAN_EXPIRED','预览计划已过期')
  if(plan.hostId!==host.hostId||plan.hostFingerprint!==host.fingerprint||await profileFingerprint(host.profileDir)!==plan.beforeState.fingerprint)fail('HOST_CHANGED','目标配置已变化，请重新预览')
  if(plan.action!=='remove'&&await fileHash(plan._inspection.archivePath)!==plan.packageSha256)fail('ARTIFACT_CHANGED','离线包已改变')
  if(plan.requiresExit&&quiesced&&adapter.isRunning&&await adapter.isRunning(host))fail('HOST_STILL_RUNNING','目标 DSH 仍在运行，待处理任务已保留')
  const installedSame=old.find(o=>['succeeded','awaiting_reload'].includes(o.state)&&o.result?.installed&&o.plan?.packageName===plan.packageName&&o.plan.packageSha256===plan.packageSha256&&o.afterFingerprint===plan.beforeState.fingerprint);if(installedSame)return installedSame
  const op=same??{schemaVersion:1,operationId:randomUUID(),hostId:host.hostId,planId:plan.planId,plan,state:'queued',eventCursor:0,snapshotId:null,result:null,error:null,createdAt:Date.now()}
  const emit=async state=>{op.state=state;op.updatedAt=Date.now();op.eventCursor++;await saveOperation(op,{storeDir});onEvent?.({...op,plan:undefined})};await emit('queued')
  if(plan.requiresExit&&!quiesced){await emit('waiting_for_host_exit');return op}
  return adapter.withWriteSession(host,async session=>{
   if(await profileFingerprint(host.profileDir)!==plan.beforeState.fingerprint)fail('HOST_CHANGED','取得写锁前配置已改变')
   let snapshot,applying=false
   try{
    if(signal?.aborted){await emit('cancelled');return op}
    await emit('backing_up');snapshot=await snapshotProfile(host,{snapshotDir:path.join(storeDir,'snapshots'),newBytes:plan.recoveryBytes});op.snapshotId=snapshot.snapshotId;op.snapshot=snapshot;await emit('applying');applying=true
    await session.apply({action:plan.action,packageName:plan.packageName,path:plan._inspection?.archivePath,storeDir:path.join(storeDir,'stores',op.operationId),signal})
    if(signal?.aborted)throw Object.assign(new Error('操作已取消'),{code:'ABORT_ERR'})
    await emit('checking_install');await session.compose();if(JSON.stringify(await configFingerprints(host.profileDir))!==JSON.stringify(plan.beforeState.configFingerprints)||unrelatedManifestChanged(plan.beforeState.manifest,(await session.readState()).manifest,plan.packageName))fail('EXTERNAL_CONFIG_CHANGED','执行期间配置被外部修改，已暂停后续操作');op.activationNonce=randomUUID();op.activationNonceDigest=digest(op.activationNonce);op.afterFingerprint=await profileFingerprint(host.profileDir);if(plan.action==='remove'&&Object.hasOwn((await session.readState()).manifest.dependencies??{},plan.packageName))fail('REMOVE_NOT_APPLIED','插件声明仍存在')
    if(plan.action!=='remove'&&session.readInventory){const row=(await session.readInventory()).find(i=>i.name===plan.packageName);if(!row||row.version!==plan.version)fail('INSTALL_IDENTITY_MISMATCH','实际安装的插件或版本与预览不一致')}
    op.result={installed:plan.action!=='remove',removed:plan.action==='remove',loaded:false,packageName:plan.packageName,version:plan.version};for(const prior of old.filter(o=>o.state==='awaiting_reload'&&o.plan?.packageName===plan.packageName)){prior.state='cancelled';prior.result={...prior.result,loaded:false,supersededBy:op.operationId,reason:plan.action==='remove'?'removed':'replaced'};delete prior.activationNonce;await saveOperation(prior,{storeDir})}
    await emit(plan.action==='remove'?'succeeded':'awaiting_reload');return op
   }catch(e){
    op.error={code:e.code??'OPERATION_FAILED',message:e.message};op.afterFingerprint=await profileFingerprint(host.profileDir).catch(()=>null)
    if(!applying){op.result={changed:false};await emit('failed_restored');return op}
    const current=await readJson(path.join(host.profileDir,'package.json'),null)
    if(!current||JSON.stringify(await configFingerprints(host.profileDir))!==JSON.stringify(plan.beforeState.configFingerprints)||unrelatedManifestChanged(plan.beforeState.manifest,current,plan.packageName)){await emit('recovery_required');return op}
    await emit('recovering');try{await restoreProfile(snapshot,{profileDir:host.profileDir,expectedCurrentFingerprint:op.afterFingerprint});op.result={restored:true};await emit('failed_restored')}catch(error){op.error.recovery={code:error.code??'RECOVERY_FAILED',message:error.message};await emit('recovery_required')}return op
   }
  },{signal,quiesced})
 })
}
export async function inspectRecovery(id,{host,storeDir}){
 const op=await readOperation(id,{storeDir});if(op.hostId!==host.hostId)fail('RECOVERY_HOST_MISMATCH','恢复任务属于其他环境')
 if(op.plan?.execution==='dsh-cli')return{operationId:id,hostId:host.hostId,state:op.state,snapshotId:null,execution:'dsh-cli',notice:'此任务直接调用 DSH，未创建完整恢复点。可重新安装相同成品包重试，或安装先前版本；安装器不会覆盖整个依赖目录。'}
 const currentFingerprint=await profileFingerprint(host.profileDir)
 let changedFiles=[];if(op.snapshot){const before=await profileRecords(op.snapshot.payload),after=await profileRecords(host.profileDir),a=new Map(before.map(r=>[r.path,JSON.stringify(r)])),b=new Map(after.map(r=>[r.path,JSON.stringify(r)]));changedFiles=[...new Set([...a.keys(),...b.keys()])].filter(p=>a.get(p)!==b.get(p))}
 return{changedFiles:changedFiles.slice(0,200),changedFilesCount:changedFiles.length,operationId:id,hostId:host.hostId,state:op.state,snapshotId:op.snapshotId??null,currentFingerprint,snapshotFingerprint:op.snapshot?.fingerprint??null,changedSinceStart:currentFingerprint!==op.plan?.beforeState?.fingerprint,requiresExit:host.capabilities.requiresExit,notice:'恢复会替换受管理的依赖与配置，请先检查外部修改；用户业务目录保留。'}
}
export async function recoverOperation(id,{host,adapter,storeDir,expectedCurrentFingerprint,quiesced=false,onEvent}={}){
 return withManagerLock(storeDir,host.hostId,async()=>{
  const op=await readOperation(id,{storeDir});if(op.hostId!==host.hostId)fail('RECOVERY_HOST_MISMATCH','此任务属于其他环境')
  if(op.plan?.execution==='dsh-cli'){if(!quiesced||await adapter.isRunning(host))fail('HOST_STILL_RUNNING','请退出 DSH 后检查中断任务');if(!['applying','checking_install'].includes(op.state))fail('NO_SNAPSHOT','此任务未创建恢复点；请重新安装成品包');op.state='failed';op.error={code:'INTERRUPTED',message:'中断任务已结束，请重新安装成品包；未修改或还原依赖目录'};op.result={installed:false,loaded:false,rollback:false};await saveOperation(op,{storeDir});return op}
  const expected=expectedCurrentFingerprint??op.afterFingerprint;if(!expected)fail('RECOVERY_CONFIRMATION_REQUIRED','请先检查当前配置并确认恢复计划')
  return adapter.withWriteSession(host,async()=>{
   if(!op.snapshot){
    if(!['queued','backing_up'].includes(op.state)||await profileFingerprint(host.profileDir)!==op.plan?.beforeState?.fingerprint||expected!==op.plan.beforeState.fingerprint)fail('SNAPSHOT_MISSING','缺少恢复点且当前配置已变化，需要人工检查')
    op.result={changed:false,restored:true}
   }else {await restoreProfile(op.snapshot,{profileDir:host.profileDir,expectedCurrentFingerprint:expected});op.result={restored:true}}
   op.state='failed_restored';op.updatedAt=Date.now();await saveOperation(op,{storeDir});onEvent?.(op);return op
  },{quiesced})
 })
}
