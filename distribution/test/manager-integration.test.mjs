import test from 'node:test'
import assert from 'node:assert/strict'
const mod=await import('../manager/verify.mjs').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return{};throw e})
test('missing real isolation evidence can never qualify manager bootstrap',async()=>{assert.equal(typeof mod.qualifyManagerReport,'function');const r=mod.qualifyManagerReport({checks:{install:true,host:true},scope:['simulated'],status:'passed'});assert.equal(r.status,'unverified');assert.ok(r.missing.includes('network-isolation'))})
