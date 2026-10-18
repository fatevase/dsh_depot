import test from 'node:test'
import assert from 'node:assert/strict'
import { initialState } from '../lib/model.mjs'
import { mergeState, pointerKey, withdraw, rollback, updateStateBranch } from '../lib/state.mjs'
const publication=(key,version='1.0.0',target='darwin-arm64')=>({buildKey:key,recipeId:'fixture',version,target,host:{version:'0.2.0-rc.2',node:'26.9.0'},status:'published',sha256:'b'.repeat(64),packageUrl:'https://github.com/x/y/releases/download/a/b.tgz',verification:{status:'passed'}})
test('persistent receipts, monotonic pointers, withdrawal and explicit rollback',()=>{
 let state=mergeState(initialState(),{discovery:{complete:true,checkedAt:'now',sources:[{recipeId:'fixture'}],candidates:[{repository:'a/b'}]},receipts:[{buildKey:'bad',attempt:'1',status:'failed'}],publications:[publication('new','2.0.0')]})
 state=mergeState(state,{publications:[publication('old')]})
 const pointer=pointerKey(publication('new'));assert.equal(state.latest[pointer],'new');assert.equal(state.receipts.bad.status,'failed');assert.equal(state.lastSuccessfulDiscoveryAt,'now');assert.equal(state.candidates.length,1)
 state=rollback(state,{key:'old',recipeId:'fixture',target:'darwin-arm64',host:publication('old').host});assert.equal(state.latest[pointer],'old')
 assert.throws(()=>rollback(state,{key:'new',recipeId:'fixture',target:'linux-x64',host:publication('old').host}))
 state=withdraw(state,'old','bad version');assert.equal(state.latest[pointer],'new');assert.throws(()=>rollback(state,{key:'old',recipeId:'fixture',target:'darwin-arm64',host:publication('old').host}))
 const repeated=mergeState(state,{receipts:[{buildKey:'bad',attempt:'1',status:'failed'}]});assert.deepEqual(repeated,state)
})
test('state CAS conflict reads current state and recalculates without losing concurrent receipts',async()=>{
 let writes=0,reads=0
 const latest=initialState();latest.receipts.concurrent={buildKey:'concurrent',status:'failed'}
 const store={read:async()=>({commit:++reads===1?'old':'new',state:reads===1?initialState():latest}),write:async expected=>{writes++;if(expected==='old'){const e=new Error('conflict');e.status=409;throw e}return{commit:'done'}}}
 const result=await updateStateBranch({store,merge:s=>mergeState(s,{receipts:[{buildKey:'local',status:'failed'}]})})
 assert.equal(result.state.receipts.concurrent.buildKey,'concurrent');assert.ok(result.state.receipts.local);assert.equal(writes,2)
 const noop=await updateStateBranch({store:{read:async()=>({commit:'a',state:latest}),write:async()=>{throw Error('must not write')}},merge:s=>s});assert.equal(noop.changed,false)
})
test('a stale discovery cannot erase a newer observation or concurrent candidate',()=>{
 const current=mergeState(initialState(),{discovery:{complete:true,checkedAt:'2026-10-18T02:00:00Z',sources:[{commit:'new'}],candidates:[{repository:'new/plugin'}]}})
 const result=mergeState(current,{discovery:{complete:true,checkedAt:'2026-10-18T01:00:00Z',sources:[{commit:'old'}],candidates:[{repository:'old/plugin'}]}})
 assert.equal(result.sources[0].commit,'new');assert.equal(result.candidates.length,2);assert.equal(result.lastSuccessfulDiscoveryAt,'2026-10-18T02:00:00Z')
})
