import test from 'node:test'
import assert from 'node:assert/strict'
import {latestHostVersion, latestSource, runtimeManifest, freezeRuntimeVersions} from '../lib/latest.mjs'
import {createPlan} from '../lib/plan.mjs'
import {recipe,source,host,sha} from './helpers.mjs'

test('host follows the official latest tag including RC; invalid versions fail closed',async()=>{
 assert.equal(await latestHostVersion(async()=>({'dist-tags':{latest:'0.2.1-rc.2',alpha:'9.0.0-alpha.1'}})),'0.2.1-rc.2')
 await assert.rejects(latestHostVersion(async()=>({'dist-tags':{latest:'garbage'}})),/latest/)
})
test('latest published semver wins independently of API order and drafts; no old seed fallback',async()=>{
 const github={list:async endpoint=>endpoint.endsWith('/releases')?[{tag_name:'v1.2.0'},{tag_name:'v1.1.0'},{tag_name:'v9.0.0',draft:true},{tag_name:'v2.0.0-rc.1',prerelease:true}]:[],request:async endpoint=>({data:endpoint.endsWith('/commits/v1.2.0')?{sha:sha('b')}:{default_branch:'trunk'}})}
 assert.deepEqual(await latestSource(recipe(),github),{ref:'v1.2.0',commit:sha('b'),channel:'release'})
})
test('tag-only projects and projects without releases follow latest tag and default branch',async()=>{
 for(const tags of [[{name:'v1.9.0'},{name:'v1.10.0'}],[]]){
  const seen=[],github={list:async endpoint=>endpoint.endsWith('/tags')?tags:[],request:async endpoint=>{seen.push(endpoint);return{data:endpoint.endsWith('/fixture/plugin')?{default_branch:'trunk'}:{sha:sha('c')}}}}
  const selected=await latestSource(recipe(),github)
  assert.equal(selected.ref,tags.length?'v1.10.0':'trunk');assert.equal(selected.commit,sha('c'))
 }
})
test('discovery failure never silently picks a default branch',async()=>{
 await assert.rejects(latestSource(recipe(),{list:async()=>{throw Error('API unavailable')}}),/unavailable/)
})
test('runtime locks include only runtime dependencies and pin the resolved direct versions',()=>{
 const manifest={name:'dsh-fixture',version:'2.0.0',scripts:{postinstall:'anything'},devDependencies:{dev:'*'},dependencies:{dep:'^1',client:'file:./client'},optionalDependencies:{optional:'^2'},peerDependencies:{host:'*'}}
 const r=runtimeManifest(manifest,{packageRules:{localPackages:[{name:'client',path:'client'}]}})
 assert.deepEqual(r,{name:'dsh-fixture',version:'2.0.0',private:true,dependencies:{dep:'^1'},optionalDependencies:{optional:'^2'}})
 const lock={packages:{'':r,'node_modules/dep':{version:'1.2.3'},'node_modules/optional':{version:'2.1.0'}}}
 freezeRuntimeVersions(r,lock);assert.equal(lock.packages[''].dependencies.dep,'1.2.3');assert.equal(lock.packages[''].optionalDependencies.optional,'2.1.0')
 assert.throws(()=>runtimeManifest({...manifest,dependencies:{unsafe:'file:../../secret'}},{}),/registry dependency/)
})
test('latest-only plan blocks incompatible newest version instead of building old version',()=>{
 const result=createPlan({recipes:[recipe({latestOnly:true})],sources:[source({version:'2.0.0',enginesDsh:'>=0.2.1-rc.2'}),source()],host})
 assert.equal(result.tasks.length,0);assert.ok(result.decisions.some(d=>d.action==='incompatible'))
})
test('official host peers and engines.dsh are checked; refreshed dependency failures stay blocked',()=>{
 for(const s of [source({enginesDsh:'>=0.2.1-rc.2'}),source({peerDependencies:{'@deepseek-ai/dsh-app-boot':'0.2.1-rc.2'}})]){
  assert.equal(createPlan({recipes:[recipe()],sources:[s],host}).tasks.length,0)
 }
 assert.equal(createPlan({recipes:[recipe({latestRefreshError:'New runtime lock failed'})],sources:[source()],host}).tasks.length,0)
})

test('latest catalog exposes only the current source on the current host',async()=>{
 const {catalogOf}=await import('../lib/publish.mjs'),{initialState}=await import('../lib/model.mjs'),config=(await import('../config.json',{with:{type:'json'}})).default
 const r=recipe({latestOnly:true,seed:{version:'2.0.0',commit:sha('b')}}),state=initialState()
 for(const [key,version,commit,hostVersion]of [['old','1.0.0',sha('a'),config.host.version],['old-host','2.0.0',sha('b'),'0.0.1'],['current','2.0.0',sha('b'),config.host.version]]){
  state.published[key]={buildKey:key,recipeId:r.id,version,source:{commit},host:{version:hostVersion},target:'linux-x64',status:'published'}
 }
 const catalog=catalogOf(state,[r]);assert.deepEqual(catalog.packages.map(p=>p.buildKey),['current'])
})

test('latest updater tests metadata before writing main and explicitly dispatches builds',async()=>{
 const {readFile}=await import('node:fs/promises')
 const w=JSON.parse(await readFile(new URL('../../.github/workflows/latest-update.yml',import.meta.url)))
 assert.ok(w.on.schedule);assert.ok(w.on.workflow_dispatch)
 assert.deepEqual(w.jobs.refresh.permissions,{contents:'read'})
 assert.ok(w.jobs.refresh.steps.find(s=>s.run==='npm test'))
 assert.equal(w.jobs.publish.needs,'refresh');assert.equal(w.jobs.publish.permissions.contents,'write');assert.equal(w.jobs.publish.permissions.actions,'write')
 assert.ok(!JSON.stringify(w.jobs.refresh).includes('persist-credentials":true'))
})

test('a higher release for another product in the same repository cannot replace this plugin',async()=>{
 const github={list:async endpoint=>endpoint.endsWith('/releases')?[{tag_name:'v2.0.0+win'},{tag_name:'v0.4.2'}]:[],request:async endpoint=>({data:{sha:endpoint.includes('v0.4.2')?sha('b'):sha('a')}}),text:async(_repo,_path,commit)=>JSON.stringify({name:commit===sha('b')?'dsh-fixture':'other-desktop-product',version:commit===sha('b')?'0.4.2':'2.0.0'})}
 assert.equal((await latestSource(recipe(),github)).ref,'v0.4.2')
})

test('engines.dsh takes precedence over legacy DSH peers as in stock DSH',()=>{
 const s=source({enginesDsh:'0.2.0-rc.2',peerDependencies:{'@deepseek-ai/dsh-app-boot':'0.1.0'}})
 assert.equal(createPlan({recipes:[recipe()],sources:[s],host}).tasks.length,3)
})

test('refresh refuses a moved immutable release even after newer releases have been observed',async()=>{
 const {assertLatestRef}=await import('../lib/latest.mjs')
 const r={releasePins:{'v1.0.0':'a'.repeat(40),'v2.0.0':'b'.repeat(40)}}
 assert.throws(()=>assertLatestRef(r,{ref:'v1.0.0',commit:'c'.repeat(40),channel:'release'}),/source_conflict/)
 assert.doesNotThrow(()=>assertLatestRef(r,{ref:'main',commit:'c'.repeat(40),channel:'branch'}))
})

test('automatic host updates explicitly publish the manager preview without weakening stable acceptance',async()=>{
 const {readFile}=await import('node:fs/promises'),w=JSON.parse(await readFile(new URL('../../.github/workflows/manager-distribution.yml',import.meta.url)))
 assert.deepEqual(w.on.workflow_dispatch.inputs.channel.options,['stable','preview'])
 const script=await readFile(new URL('../update-latest.mjs',import.meta.url),'utf8')
 assert.match(script,/publish:true,channel:'preview'/)
})

test('latest discovery blocks every platform with a visible reason and hides superseded trial downloads',async()=>{
 const {withCandidateReport}=await import('../candidate-catalog.mjs'),{platformState}=await import('../../web/catalog.mjs')
 const r=recipe({latestOnly:true,latestRefreshError:'Upstream repository unavailable'})
 const plan=createPlan({recipes:[r],sources:[],host})
 assert.equal(plan.decisions.length,3);assert.ok(plan.decisions.every(d=>d.reason===r.latestRefreshError&&d.target))
 const plugin={id:'fixture',repository:'fixture/plugin',latestOnly:true,seed:{commit:sha('b')}},snapshot={runId:10,counts:{},plugins:[{repository:'fixture/plugin',commit:sha('a'),results:{'linux-x64':{status:'compiled',files:[{url:'https://github.com/old-package'}]}}}]}
 const catalog=withCandidateReport({plugins:[plugin],packages:[],decisions:plan.decisions},snapshot)
 assert.equal(catalog.plugins[0].trial.results['linux-x64'].files.length,0)
 assert.equal(platformState(catalog,catalog.plugins[0],'linux-x64').label,'更新待处理')
})
