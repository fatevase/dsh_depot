import test from 'node:test'
import assert from 'node:assert/strict'
import {createPlan} from '../lib/plan.mjs'
import {recipe,source,host} from './helpers.mjs'
import {temporary} from './helpers.mjs'
import {mkdir,writeFile,readFile} from 'node:fs/promises'
import {execFileSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import path from 'node:path'
const inputs=()=>({recipes:['a','b','c'].map(id=>recipe({id})),sources:['a','b','c'].map(recipeId=>source({recipeId})),host})
test('a batch keeps each plugin platform group intact and subsequent runs drain remaining inputs',async()=>{
 const {selectBuildBatch}=await import('../lib/batch-policy.mjs'),args=inputs(),policy={maxPlugins:2,maxTasks:6}
 const first=selectBuildBatch(createPlan({...args,state:{}}),{policy,state:{},recipeOrder:['a','b','c']})
 assert.deepEqual(first.tasks.map(t=>t.recipeId),['a','a','a','b','b','b'])
 assert.equal(first.batch.pendingTasks,3);assert.equal(first.decisions.filter(d=>d.action==='queued').length,3)
 const state={published:Object.fromEntries(first.tasks.map(t=>[t.buildKey,{status:'published'}]))}
 const next=selectBuildBatch(createPlan({...args,state}),{policy,state,recipeOrder:['a','b','c']})
 assert.deepEqual(next.tasks.map(t=>t.recipeId),['c','c','c']);assert.equal(next.batch.pendingTasks,0)
})
test('new or least-recently-attempted plugins cannot starve behind frequent updates; explicit retry takes priority',async()=>{
 const {selectBuildBatch}=await import('../lib/batch-policy.mjs'),args=inputs(),state={receipts:{old:{recipeId:'a',attempt:'2026-10-19'},older:{recipeId:'b',attempt:'2026-10-01'}}},plan=createPlan({...args,state}),policy={maxPlugins:1,maxTasks:3}
 assert.equal(selectBuildBatch(plan,{policy,state,recipeOrder:['a','b','c']}).tasks[0].recipeId,'c')
 assert.equal(selectBuildBatch(plan,{policy,state,recipeOrder:['a','b','c'],retryKeys:['a']}).tasks[0].recipeId,'a')
 const failed={receipts:{[plan.tasks[0].buildKey]:{status:'failed',recipeId:'a',attempt:'2026-10-19'}}}
 const pending=selectBuildBatch(createPlan({...args,state:failed}),{policy,state:failed})
 assert.ok(!pending.tasks.some(t=>t.buildKey===plan.tasks[0].buildKey))
})
test('invalid budgets fail closed instead of silently dropping work or exceeding Actions matrix limits',async()=>{
 const {selectBuildBatch}=await import('../lib/batch-policy.mjs'),plan=createPlan({...inputs(),state:{}})
 for(const policy of [{maxPlugins:0,maxTasks:6},{maxPlugins:1,maxTasks:2},{maxPlugins:5,maxTasks:300},{maxPlugins:1.5,maxTasks:15}])assert.throws(()=>selectBuildBatch(plan,{policy}),/batch/i)
})
test('real CLI publication records missing receipts only for the selected batch, never for queued work',async t=>{
 const {selectBuildBatch}=await import('../lib/batch-policy.mjs'),dir=await temporary(t),args=inputs()
 await mkdir(path.join(dir,'recipes'));await mkdir(path.join(dir,'receipts'))
 for(const r of args.recipes)await writeFile(path.join(dir,'recipes',r.id+'.json'),JSON.stringify(r))
 const plan=selectBuildBatch(createPlan({...args,state:{}}),{policy:{maxPlugins:1,maxTasks:3}})
 await writeFile(path.join(dir,'plan.json'),JSON.stringify(plan))
 execFileSync(process.execPath,[fileURLToPath(new URL('../cli.mjs',import.meta.url)),'publish','--recipes',path.join(dir,'recipes'),'--receipts',path.join(dir,'receipts'),'--plan',path.join(dir,'plan.json'),'--work',dir,'--output',path.join(dir,'publication.json')],{stdio:'pipe'})
 const result=JSON.parse(await readFile(path.join(dir,'publication.json')))
 assert.deepEqual(Object.keys(result.state.receipts).sort(),plan.tasks.map(t=>t.buildKey).sort())
 assert.equal(result.state.lastPlan.batch.pendingTasks,6)
 assert.ok(result.state.lastPlan.decisions.filter(d=>d.recipeId!==plan.tasks[0].recipeId).every(d=>d.action==='queued'))
})
