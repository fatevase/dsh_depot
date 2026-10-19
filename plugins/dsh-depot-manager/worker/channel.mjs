import path from 'node:path'
import {randomBytes,randomUUID} from 'node:crypto'
import {atomicJson,digest,readJson} from '../core/files.mjs'
import {fail} from '../contracts/constants.mjs'
export async function createJob(plan,{root,ownerId,now=Date.now()}={}) {
 const nonce=randomBytes(32).toString('hex'),jobPath=path.join(root,'jobs',randomUUID()+'.json')
 await atomicJson(jobPath,{schemaVersion:1,plan,ownerId,hostId:plan.hostId,nonceDigest:digest(nonce),expiresAt:now+900000,createdAt:now})
 return {jobPath,nonce}
}
export async function authorizeJob({jobPath,nonce,ownerId,hostId,now=Date.now()}) {
 const job=await readJson(jobPath)
 if(job.schemaVersion!==1||job.ownerId!==ownerId||job.hostId!==hostId||typeof nonce!=='string'||digest(nonce)!==job.nonceDigest||now>=job.expiresAt)fail('JOB_AUTH_FAILED','任务身份或时效不符')
 return job
}
