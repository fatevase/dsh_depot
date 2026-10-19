import {readOperation,saveOperation,withManagerLock} from '../../core/receipts.mjs'
import {digest} from '../../core/files.mjs'
import {fail,MANAGER_VERSION} from '../../contracts/constants.mjs'
export async function recordActivation({operationId,nonce,hostId,version},{storeDir,observed}) {
 return withManagerLock(storeDir,hostId,async()=>{
  const op=await readOperation(operationId,{storeDir})
  if(op.state!=='awaiting_reload'||op.hostId!==hostId||typeof nonce!=='string'||digest(nonce)!==op.activationNonceDigest||!observed?.active||observed.name!==op.result?.packageName||observed.version!==version||op.result.version!==version)fail('ACTIVATION_REJECTED','加载回执不符合当前任务')
  const receipt={operationId,hostId,managerVersion:MANAGER_VERSION,loadedAt:Date.now(),nonceDigest:digest(nonce)}
  op.state='succeeded';op.result.loaded=true;op.activation=receipt;delete op.activationNonce;await saveOperation(op,{storeDir});return receipt
 })
}
