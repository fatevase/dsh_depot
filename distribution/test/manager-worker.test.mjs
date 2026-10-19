import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
const channel=await import('../manager/worker/channel.mjs').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return{};throw e})
const worker=await import('../manager/worker/main.mjs').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return{};throw e})
test('durable job authenticates nonce owner host and expiry before executing',async t=>{
 assert.equal(typeof channel.createJob,'function');const root=await mkdtemp(path.join(os.tmpdir(),'depot-job-'));t.after(()=>rm(root,{recursive:true,force:true}));const ticket=await channel.createJob({hostId:'h1',planId:'p1'},{root,ownerId:'u1',now:100});
 for(const params of [{nonce:'fake',ownerId:'u1',hostId:'h1',now:101},{nonce:ticket.nonce,ownerId:'u2',hostId:'h1',now:101},{nonce:ticket.nonce,ownerId:'u1',hostId:'h2',now:101},{nonce:ticket.nonce,ownerId:'u1',hostId:'h1',now:1000000}])await assert.rejects(()=>worker.workerMain({jobPath:ticket.jobPath,...params}),{code:'JOB_AUTH_FAILED'})
 let called=0;await worker.workerMain({jobPath:ticket.jobPath,nonce:ticket.nonce,ownerId:'u1',hostId:'h1',now:101,execute:async()=>{called++;return{state:'waiting_for_host_exit'}}});assert.equal(called,1)
})
