import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {hash} from '../adapters/discover.mjs'
const plans=await import('../core/plans.mjs').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return{};throw e})
const operations=await import('../core/operations.mjs').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return{};throw e})
import {fixture,adapterForFixture} from './manager-helpers.mjs'
test('expired or changed plans reject before a package is written',async t=>{
 assert.equal(typeof plans.createOperationPlan,'function');const f=await fixture(t);const plan=await plans.createOperationPlan({...f,host:f.host,inspection:f.inspection,action:'install',now:1000});await assert.rejects(()=>operations.executePlan(plan,{host:f.host,adapter:adapterForFixture(f),storeDir:path.join(f.dir,'state'),now:901001}),{code:'PLAN_EXPIRED'});const fresh=await plans.createOperationPlan({host:f.host,inspection:f.inspection,action:'install'});await writeFile(f.inspection.archivePath,'changed bytes');await assert.rejects(()=>operations.executePlan(fresh,{host:f.host,adapter:adapterForFixture(f),storeDir:path.join(f.dir,'state')}),{code:'ARTIFACT_CHANGED'});assert.equal(JSON.parse(await readFile(path.join(f.profile,'package.json'),'utf8')).dependencies['new-plugin'],undefined)
})
test('successful execution is idempotent and installation waits for actual load evidence',async t=>{
 assert.equal(typeof operations.executePlan,'function');const f=await fixture(t),plan=await plans.createOperationPlan({host:f.host,inspection:f.inspection,action:'install'}),ctx={host:f.host,adapter:adapterForFixture(f),storeDir:path.join(f.dir,'state')};const first=await operations.executePlan(plan,ctx);assert.equal(first.state,'awaiting_reload');const again=await operations.executePlan(plan,ctx);assert.equal(again.operationId,first.operationId);assert.equal(await readFile(path.join(f.profile,'node_modules/old/index.js'),'utf8'),'overwritten')
})
test('confirmed jobs waiting for host exit resume once without expiring their accepted execution',async t=>{
 const f=await fixture(t);f.host.capabilities.requiresExit=true;const plan=await plans.createOperationPlan({host:f.host,inspection:f.inspection,action:'install',now:1000}),ctx={host:f.host,adapter:adapterForFixture(f),storeDir:path.join(f.dir,'state')};const waiting=await operations.executePlan(plan,{...ctx,now:1001});assert.equal(waiting.state,'waiting_for_host_exit');const resumed=await operations.executePlan(plan,{...ctx,quiesced:true,now:10000000});assert.equal(resumed.state,'awaiting_reload');assert.equal(resumed.operationId,waiting.operationId)
})
