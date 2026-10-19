import test from 'node:test'
import assert from 'node:assert/strict'
import {fixture} from './manager-helpers.mjs'
import {saveOperation,readOperation} from '../manager/core/receipts.mjs'
import {digest} from '../manager/core/files.mjs'
const mod=await import('../manager/plugin/host/activation.mjs').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return{};throw e})
test('only host-observed matching version and nonce may mark loaded',async t=>{
 assert.equal(typeof mod.recordActivation,'function');const f=await fixture(t),op={operationId:'load-me',hostId:f.host.hostId,state:'awaiting_reload',activationNonceDigest:digest('secret'),result:{packageName:'test-plugin',version:'1.0.0',loaded:false}};await saveOperation(op,{storeDir:f.dir});await assert.rejects(()=>mod.recordActivation({operationId:op.operationId,nonce:'fake',hostId:op.hostId,version:'1.0.0'},{storeDir:f.dir,observed:{name:'test-plugin',version:'1.0.0',active:true}}),{code:'ACTIVATION_REJECTED'});await mod.recordActivation({operationId:op.operationId,nonce:'secret',hostId:op.hostId,version:'1.0.0'},{storeDir:f.dir,observed:{name:'test-plugin',version:'1.0.0',active:true}});assert.equal((await readOperation(op.operationId,{storeDir:f.dir})).state,'succeeded')
})
