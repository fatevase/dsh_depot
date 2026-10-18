import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { writeFile } from 'node:fs/promises'
import { initialState,fileDigest,buildKey,jsonDigest } from '../lib/model.mjs'
import { publishBatch, catalogOf } from '../lib/publish.mjs'
import { temporary,recipe,source,host as baselineHost } from './helpers.mjs'
test('catalog excludes historical publications, pointers and issues outside selected recipes without mutating state',()=>{
 const state=initialState()
 for(const id of ['fixture','mobile']){
  state.published[id]={recipeId:id,buildKey:id,status:'published'}
  state.latest[`${id}|host`]=id
  state.receipts[id]={recipeId:id,target:'linux-x64',status:'failed'}
 }
 state.lastPlan={decisions:[{recipeId:'fixture'},{recipeId:'mobile'}]}
 const before=structuredClone(state),catalog=catalogOf(state,[recipe()])
 assert.deepEqual(catalog.packages.map(p=>p.recipeId),['fixture'])
 assert.deepEqual(catalog.latest,{'fixture|host':'fixture'})
 assert.deepEqual(catalog.issues.map(p=>p.recipeId),['fixture'])
 assert.deepEqual(catalog.decisions,[{recipeId:'fixture'}])
 assert.deepEqual(state,before)
})
async function fixture(t){const dir=await temporary(t),file=path.join(dir,'fixture.tgz');await writeFile(file,'immutable package');const sha256=await fileDigest(file),host=baselineHost,rec=recipe(),src=source(),key=buildKey({recipe:rec,source:src,host,target:'darwin-arm64'});const receipt={schemaVersion:1,buildKey:key,recipeId:'fixture',recipeDigest:jsonDigest(rec),plannedAt:'2026-10-18T01:00:00Z',source:src,host,target:'darwin-arm64',status:'verified',attempt:'1',artifacts:{package:file,sha256,compressedBytes:17,unpackedBytes:20},verification:{schemaVersion:1,buildKey:key,host,target:'darwin-arm64',sha256,status:'passed',isolationControls:{beforeReachable:true,beforeReachableIPv6:true,offline:{externalBlocked:true,externalBlockedIPv6:true,childBlockedIPv6:true,otherProgramBlocked:true,childBlocked:true,loopbackBlocked:true},loopback:{externalBlocked:true,externalBlockedIPv6:true,childBlockedIPv6:true,otherProgramBlocked:true,childBlocked:true,loopbackAllowed:true}},checks:{install:true,compose:true,host:true,clientModule:true,native:true}}};receipt._recipe=rec;receipt._tasks=[{buildKey:key,recipeId:receipt.recipeId,recipeDigest:receipt.recipeDigest,plannedAt:receipt.plannedAt,source:structuredClone(src),host:structuredClone(host),target:receipt.target}];return receipt}
test('dry run is default; invalid bytes, missing reports and withdrawn keys never upload',async t=>{
 const receipt=await fixture(t),state=initialState(),remote={ensureDraft:async()=>{throw Error('must not mutate')}}
 const dry=await publishBatch({tasks:receipt._tasks,recipes:[receipt._recipe],batchId:'1',repository:'x/y',state,receipts:[receipt],remote});assert.equal(dry.actions[0].action,'would_publish');assert.deepEqual(dry.state.published,{})
 for(const mutate of [r=>r.status='failed',r=>r.verification.status='unverified',r=>delete r.verification,r=>r.verification.target='linux-x64',r=>r.artifacts.sha256='0'.repeat(64)]){const bad=structuredClone(receipt);mutate(bad);const result=await publishBatch({tasks:receipt._tasks,recipes:[receipt._recipe],batchId:'1',repository:'x/y',state,receipts:[bad],remote,dryRun:false});assert.equal(result.actions[0].action,'rejected');assert.deepEqual(result.state.latest,{})}
 state.withdrawn[receipt.buildKey]={reason:'withdrawn'};assert.equal((await publishBatch({tasks:receipt._tasks,recipes:[receipt._recipe],batchId:'1',repository:'x/y',state,receipts:[receipt],remote})).actions[0].action,'rejected')
})
test('verified assets resume without overwrite, and all uploads precede public release',async t=>{
 const receipt=await fixture(t),events=[],assets=new Map()
 const remote={ensureDraft:async()=>({id:1,draft:true}),asset:async(_,name)=>assets.get(name),upload:async(_,name,file,sha)=>{events.push('upload');const a={sha256:sha,url:`https://github.com/x/y/releases/download/depot-1/${name}`};assets.set(name,a);return a},publish:async()=>{events.push('publish')}}
 const options={tasks:receipt._tasks,recipes:[receipt._recipe],batchId:'1',repository:'x/y',state:initialState(),receipts:[receipt],remote,dryRun:false}
 const first=await publishBatch(options);assert.equal(first.state.published[receipt.buildKey].status,'published');assert.equal(events.at(-1),'publish');const count=events.filter(x=>x==='upload').length
 await publishBatch(options);assert.equal(events.filter(x=>x==='upload').length,count)
 const corrupt=[...assets.keys()][0];assets.set(corrupt,{sha256:'wrong',url:'bad'});await assert.rejects(publishBatch(options),/conflict|checksum/i)
})

test('receipt metadata must match a planned task and duplicate or extra keys are rejected',async t=>{
 const r=await fixture(t),task={schemaVersion:1,buildKey:r.buildKey,recipeId:r.recipeId,source:structuredClone(r.source),host:structuredClone(r.host),target:r.target,recipeDigest:r.recipeDigest,plannedAt:r.plannedAt}
 const bad=structuredClone(r);bad.target='linux-x64';bad.verification.target='linux-x64';bad.source.version='99.0.0'
 const result=await publishBatch({batchId:'1',state:initialState(),receipts:[bad],tasks:[task],recipes:[r._recipe]});assert.equal(result.actions[0].action,'rejected')
 const extra=await publishBatch({batchId:'1',state:initialState(),receipts:[r],tasks:[],recipes:[r._recipe]});assert.equal(extra.actions[0].action,'rejected')
 const dupe=await publishBatch({batchId:'1',state:initialState(),receipts:[r,r],tasks:[task],recipes:[r._recipe]});assert.ok(dupe.actions.every(a=>a.action==='rejected'))
})
