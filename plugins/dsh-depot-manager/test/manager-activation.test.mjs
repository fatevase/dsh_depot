import test from 'node:test'
import assert from 'node:assert/strict'
import {fixture} from './manager-helpers.mjs'
import {saveOperation,readOperation} from '../core/receipts.mjs'
import {digest} from '../core/files.mjs'
const mod=await import('../plugin/host/activation.mjs').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return{};throw e})
test('only host-observed matching version and nonce may mark loaded',async t=>{
 assert.equal(typeof mod.recordActivation,'function');const f=await fixture(t),op={operationId:'load-me',updatedAt:100000,hostId:f.host.hostId,state:'awaiting_reload',activationNonceDigest:digest('secret'),result:{packageName:'test-plugin',version:'1.0.0',loaded:false}};await saveOperation(op,{storeDir:f.dir});await assert.rejects(()=>mod.recordActivation({operationId:op.operationId,nonce:'fake',hostId:op.hostId,version:'1.0.0'},{storeDir:f.dir,observed:{name:'test-plugin',version:'1.0.0',active:true,hostStartedAt:120000}}),{code:'ACTIVATION_REJECTED'});await mod.recordActivation({operationId:op.operationId,nonce:'secret',hostId:op.hostId,version:'1.0.0'},{storeDir:f.dir,observed:{name:'test-plugin',version:'1.0.0',active:true,hostStartedAt:120000}});assert.equal((await readOperation(op.operationId,{storeDir:f.dir})).state,'succeeded')
})
test('the running old host cannot acknowledge a same-version reinstall before restart',async t=>{
 const f=await fixture(t),op={operationId:'live-replace',hostId:f.host.hostId,state:'awaiting_reload',updatedAt:110000,activationNonceDigest:digest('secret'),result:{packageName:'same-plugin',version:'1.0.0',loaded:false}}
 await saveOperation(op,{storeDir:f.dir})
 const input={operationId:op.operationId,nonce:'secret',hostId:op.hostId,version:'1.0.0'},observed={name:'same-plugin',version:'1.0.0',active:true,hostStartedAt:100000}
 await assert.rejects(()=>mod.recordActivation(input,{storeDir:f.dir,observed}),{code:'ACTIVATION_REJECTED'})
 assert.equal((await readOperation(op.operationId,{storeDir:f.dir})).state,'awaiting_reload')
 await mod.recordActivation(input,{storeDir:f.dir,observed:{...observed,hostStartedAt:120000}})
 assert.equal((await readOperation(op.operationId,{storeDir:f.dir})).result.loaded,true)
})
