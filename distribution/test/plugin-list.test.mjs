import test from 'node:test'
import assert from 'node:assert/strict'
import {writeFile} from 'node:fs/promises'
import path from 'node:path'
import {temporary} from './helpers.mjs'
import {discover} from '../lib/discover.mjs'
import {mergeState} from '../lib/state.mjs'
import {initialState} from '../lib/model.mjs'
const candidate={repositoryId:123,repository:'new/plugin',stars:51,pushedAt:'2026-10-18T00:00:00Z',processing:{state:'needs_recipe'}}
test('maintained JSON selects only active recipes and rejects duplicate repository identities',async t=>{
 const {readPluginList}=await import('../lib/plugin-list.mjs'),dir=await temporary(t),file=path.join(dir,'plugins.json')
 const list={schemaVersion:1,selection:{minStars:50,cutoffInclusive:'2026-09-19T00:00:00+08:00'},active:[{recipeId:'fixture',repository:'fixture/plugin'}],candidates:[candidate]}
 await writeFile(file,JSON.stringify(list));const loaded=await readPluginList({pluginList:'plugins.json'},dir)
 assert.deepEqual(loaded.active,list.active);assert.equal(loaded.candidates.length,1)
 await writeFile(file,JSON.stringify({...list,candidates:[candidate,{...candidate,repository:'renamed/plugin'}]}));await assert.rejects(()=>readPluginList({pluginList:'plugins.json'},dir),/Duplicate/)
 await writeFile(file,JSON.stringify({...list,candidates:[{...candidate,stars:49}]}));await assert.rejects(()=>readPluginList({pluginList:'plugins.json'},dir),/selection/)
})
test('maintained candidates refresh renamed metadata without creating build sources or losing operator notes',async()=>{
 const current={...candidate,repository:'renamed/plugin',ranks:{trending:12}}
 const result=await discover({recipes:[],github:{cache:{}},maintainedCandidates:[current],previous:{candidates:[{repositoryId:123,repository:'old/plugin',notes:'keep',discoveredAt:'2026-10-01'}]}})
 assert.equal(result.candidates.length,1);assert.equal(result.candidates[0].repository,'renamed/plugin');assert.equal(result.candidates[0].notes,'keep');assert.equal(result.candidates[0].discoveredAt,'2026-10-01');assert.deepEqual(result.sources,[])
})
test('discovery persists candidate updates, repository renames and activation without losing concurrent candidates',async()=>{
 const previous={...initialState(),lastDiscoveryAt:'2026-10-18T00:00:00Z',candidates:[{...candidate,notes:'keep'},{repositoryId:456,repository:'active/plugin'},{repository:'concurrent/plugin'}]}
 const refreshed=await discover({recipes:[],github:{cache:{}},previous,maintainedCandidates:[{...candidate,stars:60,processing:{state:'auditing'}}]})
 const updated=mergeState(previous,{discovery:refreshed})
 assert.equal(updated.candidates.find(c=>c.repositoryId===123).stars,60)
 assert.equal(updated.candidates.find(c=>c.repositoryId===123).processing.state,'auditing')
 const renamed=await discover({recipes:[{repository:'upgraded/plugin',enabled:false}],github:{cache:{}},previous:updated,maintainedCandidates:[{...candidate,repository:'renamed/plugin'},{repositoryId:456,repository:'upgraded/plugin'}]})
 renamed.checkedAt='2026-10-20T00:00:00Z'
 const concurrent={...updated,candidates:[...updated.candidates,{repository:'late/plugin'}]}
 const result=mergeState(concurrent,{discovery:renamed})
 assert.deepEqual(result.candidates.map(c=>c.repository).sort(),['concurrent/plugin','late/plugin','renamed/plugin'])
 assert.equal(result.candidates.find(c=>c.repositoryId===123).notes,'keep')
 const replayed=mergeState(result,{discovery:refreshed})
 assert.deepEqual(replayed.candidates,result.candidates)
})
