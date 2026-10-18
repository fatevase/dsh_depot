import test from 'node:test'
import assert from 'node:assert/strict'
import { createPlan } from '../lib/plan.mjs'
import { recipe, source, host } from './helpers.mjs'
const plan=(opts={})=>createPlan({recipes:[recipe()],sources:[source()],state:{},host,...opts})
test('new compatible source fans out to three independent target tasks',()=>{const p=plan();assert.equal(p.tasks.length,3);assert.deepEqual(p.tasks.map(t=>t.target),['macos-arm64','linux-x64','win32-x64'])})
test('published inputs skip; failed inputs require explicit retry',()=>{
 const first=plan(),key=first.tasks[0].buildKey
 assert.equal(plan({state:{published:{[key]:{status:'published'}}}}).tasks.length,2)
 assert.equal(plan({state:{receipts:{[key]:{status:'failed'}}}}).decisions[0].action,'needs_attention')
 assert.equal(plan({state:{receipts:{[key]:{status:'failed'}}},retryKeys:[key]}).tasks.length,3)
})
test('latest incompatible version falls back to highest compatible source',()=>{
 const p=plan({sources:[source({version:'2.0.0',peerDependencies:{'@deepseek-ai/dsh':'>=0.2.1-rc.1'}}),source()]})
 assert.equal(p.tasks.length,3);assert.ok(p.tasks.every(t=>t.source.version==='1.0.0'))
 assert.ok(p.decisions.some(d=>d.action==='incompatible'))
})
test('unknown sources, shifted tags, missing locks and withdrawn packages do not build blindly',()=>{
 assert.equal(plan({sources:[source({recipeId:'unknown'})]}).decisions[0].action,'needs_recipe')
 assert.equal(plan({sources:[source({error:{code:'source_conflict',message:'moved tag'}})]}).tasks.length,0)
 assert.equal(plan({sources:[source({lockDigests:{}})]}).decisions[0].action,'blocked')
 const key=plan().tasks[0].buildKey
 assert.equal(plan({state:{withdrawn:{[key]:{reason:'bad'}}}}).decisions[0].action,'withdrawn')
})
test('unchanged unverified targets do not automatically consume more build minutes',()=>{const p=plan();assert.equal(plan({state:{receipts:{[p.tasks[1].buildKey]:{status:'unverified'}}}}).tasks.length,2)})
test('publication resumes only when staged bytes match the verified hash',()=>{
 const key=plan().tasks[0].buildKey,r={status:'verified',artifacts:{sha256:'a'.repeat(64)}}
 assert.equal(plan({state:{receipts:{[key]:r},availableArtifacts:{[key]:{sha256:'wrong'}}}}).decisions[0].action,'build')
 assert.equal(plan({state:{receipts:{[key]:r},availableArtifacts:{[key]:{sha256:'a'.repeat(64)}}}}).decisions[0].action,'publish')
 assert.equal(plan({state:{receipts:{[key]:{status:'missing'}}}}).decisions[0].action,'needs_attention')
})
test('unsupported cohort members receive an explicit needs-recipe outcome for every target',()=>{
 const p=plan({recipes:[recipe({enabled:false,blockedReason:'TUI needs submodule and terminal verification'})],sources:[]})
 assert.equal(p.tasks.length,0);assert.equal(p.decisions.length,3)
 assert.ok(p.decisions.every(d=>d.action==='needs_recipe'&&d.reason.includes('submodule')))
})
test('a cohort member with no usable source is reported instead of disappearing from the plan',()=>{
 const p=plan({sources:[]});assert.equal(p.tasks.length,0);assert.equal(p.decisions.length,3);assert.ok(p.decisions.every(d=>d.action==='blocked'))
})
