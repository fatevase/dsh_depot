import path from 'node:path'
import {createBatch,startBatch} from '../../core/batches.mjs'
import {hostFingerprint} from '../../adapters/discover.mjs'
import {createImport,finishImport} from '../../core/imports.mjs'
import {createOperationPlan} from '../../core/plans.mjs'
import {executePlan,readOperation,recoverOperation,inspectRecovery} from '../../core/operations.mjs'
import {operationsIn,checkedId} from '../../core/receipts.mjs'
import {atomicJson,readJson,digest} from '../../core/files.mjs'
import {fail,MANAGER_NAME} from '../../contracts/constants.mjs'
export function publicHost(h){return{hostId:h.hostId,kind:h.kind,version:h.version,profileName:h.profileName,runtime:h.runtime,runtimeTarget:h.target,capabilities:h.capabilities}}
export function publicOperation(op){return{operationId:op.operationId,planId:op.planId,state:op.state,eventCursor:op.eventCursor,result:op.result,error:op.error?{code:op.error.code,message:op.error.message}:null,updatedAt:op.updatedAt}}
export const publicInspection=i=>({importId:i.importId,packageName:i.packageName,version:i.version,sha256:i.sha256,target:i.target,checks:i.checks,warnings:i.warnings,blockers:i.blockers??[],unpackedBytes:i.unpackedBytes})
export const publicPlan=p=>({planId:p.planId,hostId:p.hostId,action:p.action,packageName:p.packageName,version:p.version,previousVersion:p.previousVersion,packageSha256:p.packageSha256,requiresExit:p.requiresExit,recoveryBytes:p.recoveryBytes,expiresAt:p.expiresAt})
export function createManagerApi({host,ownerId,storeDir,adapter,listBundles,trustIndex={}}) {
 const imports=path.join(storeDir,'imports'),controllers=new Map()
 async function inventory(){return(await listBundles()).map(b=>({name:b.name,version:b.version??null,enabled:b.enabled,installed:b.installed,protected:!b.removable||b.name===MANAGER_NAME||b.name.startsWith('@deepseek-ai/'),fingerprint:digest(JSON.stringify({name:b.name,version:b.version,enabled:b.enabled,installed:b.installed})),problem:b.error?.code??null}))}
 async function ownedOperation(id){const op=await readOperation(checkedId(id),{storeDir});if(op.hostId!==host.hostId||(op.plan?.ownerId&&op.plan.ownerId!==ownerId))fail('FORBIDDEN','任务属于另一用户或环境');return op}
 return {async invoke(method,input={},actor){
  if(actor!==ownerId)fail('FORBIDDEN','请求未通过当前用户鉴权')
  if(input===null||typeof input!=='object'||Array.isArray(input))fail('INVALID_REQUEST','输入必须为对象')
  switch(method){
   case 'environment.current':return publicHost(host)
   case 'installed.list':return inventory()
   case 'imports.create':{const s=await createImport({workDir:imports,hostId:host.hostId,ownerId});return {importId:s.importId,state:s.state,bytes:0}}
   case 'imports.finish':{const session=await readJson(path.join(imports,checkedId(input.importId),'session.json'));if(Object.values(session.files??{}).some(f=>!f.finished))fail('UPLOAD_INCOMPLETE','仍有文件未上传完成');return publicInspection(await finishImport(input.importId,{workDir:imports,host,ownerId,trustIndex}))}
   case 'batches.create':{
    if(!Array.isArray(input.importIds)||input.importIds.length>20)fail('INVALID_BATCH','每批最多 20 项')
    const inspections=[];for(const id of input.importIds){const root=path.join(imports,checkedId(id)),s=await readJson(path.join(root,'session.json'));if(s.hostId!==host.hostId||s.ownerId!==ownerId)fail('FORBIDDEN','导入项不属于当前用户');inspections.push(await readJson(path.join(root,'inspection.json')))}
    if(host.dshRoot)host.fingerprint=await hostFingerprint(host)
    return createBatch({host,inspections,acceptUnverified:input.acceptUnverified===true,ownerId,storeDir})
   }
   case 'batches.start':{
    const b=await readJson(path.join(storeDir,'batches',checkedId(input.batchId)+'.json'));if(b.ownerId!==ownerId)fail('FORBIDDEN','批次属于其他用户');if(host.capabilities.requiresExit&&!host.capabilities.externalToolkit)fail('TOOLKIT_REQUIRED','请先运行外部脚本注册维护工具');return publicOperation(await startBatch(input.batchId,{host,storeDir}))
   }
   case 'plans.create':{
    let inspection,installedFingerprint
    if(input.action==='remove'){const row=(await inventory()).find(x=>x.name===input.packageName);if(!row||row.protected)fail('PROTECTED_PACKAGE','此项不可卸载');if(input.installedFingerprint!==row.fingerprint)fail('HOST_CHANGED','插件已变化，请刷新');installedFingerprint=row.fingerprint}
    else {const root=path.join(imports,checkedId(input.importId)),s=await readJson(path.join(root,'session.json'));if(s.hostId!==host.hostId||s.ownerId!==ownerId)fail('FORBIDDEN','导入项属于其他环境');inspection=await readJson(path.join(root,'inspection.json'))}
    if(host.dshRoot)host.fingerprint=await hostFingerprint(host)
    const p=await createOperationPlan({host,inspection,packageName:input.action==='remove'?input.packageName:undefined,installedFingerprint,action:input.action,acceptUnverified:input.acceptUnverified===true});p.ownerId=ownerId;await atomicJson(path.join(storeDir,'plans',p.planId+'.json'),p);return publicPlan(p)
   }
   case 'operations.start':{
    if(host.capabilities.requiresExit&&!host.capabilities.externalToolkit)fail('TOOLKIT_REQUIRED','请先运行外部脚本，注册保存在插件目录之外的维护工具')
    const p=await readJson(path.join(storeDir,'plans',checkedId(input.planId)+'.json'));if(p.hostId!==host.hostId||p.ownerId!==ownerId)fail('FORBIDDEN','计划属于其他环境')
    const controller=new AbortController();controllers.set(p.planId,controller)
    try{return publicOperation(await executePlan(p,{host,adapter,storeDir,signal:controller.signal,quiesced:false}))}finally{controllers.delete(p.planId)}
   }
   case 'operations.list':return(await operationsIn(storeDir)).filter(o=>o.hostId===host.hostId&&(!o.plan?.ownerId||o.plan.ownerId===ownerId)).map(publicOperation)
   case 'operations.status':case 'operations.events':return publicOperation(await ownedOperation(input.operationId))
   case 'operations.cancel':{const o=await ownedOperation(input.operationId);const controller=controllers.get(o.planId);if(controller){controller.abort();return{state:'recovering'}}return{state:o.state,code:'RESUME_FROM_SCRIPT'}}
   case 'recovery.inspect':{const o=await ownedOperation(input.operationId);return{...publicOperation(o),...await inspectRecovery(input.operationId,{host,storeDir}),hasSnapshot:!!o.snapshotId,code:'RESUME_FROM_SCRIPT'}}
   case 'recovery.restore':await ownedOperation(input.operationId);fail('RESUME_FROM_SCRIPT','请退出 DSH 并从外部脚本检查恢复点')
   default:fail('UNKNOWN_METHOD','不支持的操作')
  }
 },uploadContext:{workDir:imports,hostId:host.hostId,ownerId}}
}
