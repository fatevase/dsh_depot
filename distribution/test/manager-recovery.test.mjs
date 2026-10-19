import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile,mkdir,writeFile} from 'node:fs/promises'
import path from 'node:path'
import {fixture,adapterForFixture} from './manager-helpers.mjs'
const plans=await import('../manager/core/plans.mjs').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return{};throw e})
const api=await import('../manager/core/operations.mjs').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return{};throw e})
test('failed package changes restore the entire dependency graph and preserve user data',async t=>{
 assert.equal(typeof api.executePlan,'function');const f=await fixture(t);await mkdir(path.join(f.profile,'user-data'));await writeFile(path.join(f.profile,'user-data/keep'),'important');const plan=await plans.createOperationPlan({host:f.host,inspection:f.inspection,action:'install'}),op=await api.executePlan(plan,{host:f.host,adapter:adapterForFixture(f,{fail:true}),storeDir:path.join(f.dir,'state')});assert.equal(op.state,'failed_restored');assert.equal(await readFile(path.join(f.profile,'node_modules/old/index.js'),'utf8'),'old content');assert.deepEqual(JSON.parse(await readFile(path.join(f.profile,'package.json'),'utf8')).dependencies,{old:'1.0.0'});assert.equal(await readFile(path.join(f.profile,'user-data/keep'),'utf8'),'important')
})
test('recovery does not overwrite unrelated edits made during a failed operation',async t=>{
 assert.equal(typeof api.executePlan,'function');const f=await fixture(t),plan=await plans.createOperationPlan({host:f.host,inspection:f.inspection,action:'install'}),op=await api.executePlan(plan,{host:f.host,adapter:adapterForFixture(f,{fail:true,external:true}),storeDir:path.join(f.dir,'state')});assert.equal(op.state,'recovery_required');assert.equal(JSON.parse(await readFile(path.join(f.profile,'package.json'),'utf8')).userChanged,'preserve')
})

import {snapshotProfile,profileFingerprint} from '../manager/core/snapshots.mjs'
import {saveOperation} from '../manager/core/receipts.mjs'
test('cancel after dependency mutation restores the complete snapshot',async t=>{
 const f=await fixture(t),controller=new AbortController(),base=adapterForFixture(f),adapter={async withWriteSession(host,fn){return base.withWriteSession(host,session=>fn({...session,async apply(action){await session.apply(action);controller.abort()}}))}};
 const plan=await plans.createOperationPlan({host:f.host,inspection:f.inspection,action:'install'}),op=await api.executePlan(plan,{host:f.host,adapter,signal:controller.signal,storeDir:path.join(f.dir,'state')});assert.equal(op.state,'failed_restored');assert.equal(await readFile(path.join(f.profile,'node_modules/old/index.js'),'utf8'),'old content')
})
test('crashed operation requires explicit recovery and corrupted backups never overwrite current files',async t=>{
 const f=await fixture(t),storeDir=path.join(f.dir,'state'),snapshot=await snapshotProfile(f.host,{snapshotDir:path.join(storeDir,'snapshots')});await writeFile(path.join(f.profile,'node_modules/old/index.js'),'interrupted');
 const op={operationId:'crashed',hostId:f.host.hostId,state:'applying',snapshot};await saveOperation(op,{storeDir});const expected=await profileFingerprint(f.profile);
 await assert.rejects(()=>api.recoverOperation(op.operationId,{host:f.host,adapter:adapterForFixture(f),storeDir}),{code:'RECOVERY_CONFIRMATION_REQUIRED'});
 await writeFile(path.join(snapshot.payload,'node_modules/old/index.js'),'corrupt');await assert.rejects(()=>api.recoverOperation(op.operationId,{host:f.host,adapter:adapterForFixture(f),storeDir,expectedCurrentFingerprint:expected}),{code:'SNAPSHOT_CORRUPT'});assert.equal(await readFile(path.join(f.profile,'node_modules/old/index.js'),'utf8'),'interrupted')
})
test('preflight refuses unrealistic disk needs without changing the profile',async t=>{
 const f=await fixture(t),before=await profileFingerprint(f.profile);await assert.rejects(()=>snapshotProfile(f.host,{snapshotDir:path.join(f.dir,'snapshots'),newBytes:Number.MAX_SAFE_INTEGER}),{code:'DISK_SPACE'});assert.equal(await profileFingerprint(f.profile),before)
})
