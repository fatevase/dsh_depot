import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir,writeFile,readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { temporary,recipe,source,host } from './helpers.mjs'
import { buildKey,initialState,jsonDigest } from '../lib/model.mjs'
import { createPlan } from '../lib/plan.mjs'
import { mergeState,pointerKey } from '../lib/state.mjs'
import { discover } from '../lib/discover.mjs'
import { runCommand,isolatedEnv } from '../lib/process.mjs'

test('host graph changes enter deterministic build identity',async t=>{
 const {hostEnvironmentDigest}=await import('../lib/host-environment.mjs')
 const dir=await temporary(t);for(const name of ['package.json','pnpm-workspace.yaml','pnpm-lock.yaml'])await writeFile(path.join(dir,name),'one')
 const first=hostEnvironmentDigest(dir);await writeFile(path.join(dir,'pnpm-lock.yaml'),'two');const second=hostEnvironmentDigest(dir);assert.notEqual(first,second)
 assert.notEqual(buildKey({recipe:recipe(),source:source(),target:'macos-arm64',host:{...host,environmentDigest:first}}),buildKey({recipe:recipe(),source:source(),target:'macos-arm64',host:{...host,environmentDigest:second}}))
})
test('late and retried equal-version old-source jobs never replace the newer source',()=>{
 const p=(key,observedAt,plannedAt)=>({buildKey:key,recipeId:'fixture',version:'1.0.0',source:{commit:key,observedAt},host,target:'macos-arm64',status:'published',sha256:key,publishedAt:plannedAt,plannedAt})
 const newer=p('new','2026-10-18T02:00Z','2026-10-18T02:01Z'),older=p('old','2026-10-18T01:00Z','2026-10-18T03:00Z')
 const state=mergeState(mergeState(initialState(),{publications:[newer]}),{publications:[older]});assert.equal(state.latest[pointerKey(newer)],'new')
})
test('deleted immutable ref identity remains remembered after active discovery changes',async()=>{
 const old={...source(),ref:'v1.0.0'};let state=mergeState(initialState(),{discovery:{complete:true,checkedAt:'1',sources:[old],candidates:[]}})
 state=mergeState(state,{discovery:{complete:true,checkedAt:'2',sources:[],candidates:[]}})
 const github={list:async()=>[{name:'v1.0.0',commit:{sha:'b'.repeat(40)}}],request:async()=>({data:{sha:'b'.repeat(40)}}),text:async(_r,f)=>f==='package.json'?JSON.stringify({name:'dsh-fixture',version:'1.0.0'}):'{}'}
 const result=await discover({recipes:[recipe()],previous:state,github});assert.equal(result.sources[0].error?.code,'source_conflict');assert.equal(result.sources[0].commit,old.commit)
})
test('normal seed discovery retains the pinned source archive hash',async()=>{
 const r=recipe({channel:{type:'fixed',ref:'a'.repeat(40)},seed:{ref:'v1.0.0',commit:'a'.repeat(40),archiveSha256:'c'.repeat(64)}})
 const github={request:async()=>({data:{sha:'a'.repeat(40)}}),text:async(_r,f)=>f==='package.json'?JSON.stringify({name:'dsh-fixture',version:'1.0.0'}):'{}'}
 const result=await discover({recipes:[r],github});assert.equal(result.sources[0].archiveSha256,r.seed.archiveSha256)
})
test('native probes reject dependencies satisfied outside the installed closure',async t=>{
 const dir=await temporary(t),home=path.join(dir,'home'),pkg=path.join(home,'profiles/web/node_modules/dsh-fixture'),outside=path.join(home,'node_modules/leaked-native');await mkdir(pkg,{recursive:true});await mkdir(outside,{recursive:true});await writeFile(path.join(pkg,'package.json'),'{}');await writeFile(path.join(outside,'index.js'),'module.exports=1')
 const input=path.join(dir,'input.json');await writeFile(input,JSON.stringify({npmName:'dsh-fixture',probes:{native:['leaked-native']}}));const env=await isolatedEnv(dir);env.DSH_HOME=home
 const r=await runCommand({argv:[process.execPath,fileURLToPath(new URL('../lib/native-probe.mjs',import.meta.url)),input],cwd:dir,env,logFile:path.join(dir,'native.log')});assert.notEqual(r.exitCode,0);assert.match(r.output,/outside.*closure/i)
})
test('a skill bundle cannot pass its installed-file probe when the declared skill is absent',async t=>{
 const dir=await temporary(t),home=path.join(dir,'home'),pkg=path.join(home,'profiles/web/node_modules/dsh-fixture');await mkdir(pkg,{recursive:true});await writeFile(path.join(pkg,'package.json'),'{}')
 const input=path.join(dir,'input.json');await writeFile(input,JSON.stringify({npmName:'dsh-fixture',probes:{native:[],skillFiles:['skills/html/SKILL.md']}}));const env=await isolatedEnv(dir);env.DSH_HOME=home
 const r=await runCommand({argv:[process.execPath,fileURLToPath(new URL('../lib/native-probe.mjs',import.meta.url)),input],cwd:dir,env,logFile:path.join(dir,'skill.log')});assert.notEqual(r.exitCode,0)
})
test('install instruction exactly names the immutable downloaded file and rejects unsafe names',async()=>{
 const {installCommand}=await import('../../web/catalog.mjs')
 assert.equal(installCommand({fileName:'taskfold-1.0.0-key.tgz'}),'dsh plugin --profile web add "./taskfold-1.0.0-key.tgz" --offline --ignore-scripts')
 assert.throws(()=>installCommand({fileName:'bad";echo secret.tgz'}))
})
test('default branch publication and latest-state Pages deployment share a serialization boundary',async()=>{
 const w=JSON.parse(await readFile(new URL('../../.github/workflows/plugin-distribution.yml',import.meta.url)))
 for(const name of ['discover','publish'])assert.ok(w.jobs[name].if.includes('default_branch'))
 const pages=JSON.parse(await readFile(new URL('../../.github/workflows/web-pages.yml',import.meta.url))).jobs.pages
 assert.equal(pages.concurrency.group,w.jobs.publish.concurrency.group)
 assert.ok(pages.steps.some(s=>s.run==='node distribution/deploy-site.mjs build'))
 assert.ok(!pages.steps.some(s=>s.with?.name==='distribution-site'))
})
test('an old deployment retry regenerates from current state and cannot resurrect a withdrawal',async t=>{
 const {refreshDeployment}=await import('../lib/deploy.mjs'),dir=await temporary(t),state=initialState()
 state.published.old={buildKey:'old',recipeId:'fixture',status:'published',version:'1.0.0',host,target:'macos-arm64',packageUrl:'https://github.com/a/b/releases/download/1/old.tgz',verification:{status:'passed'}};state.latest[pointerKey(state.published.old)]='old'
 let current={commit:'old',state};const store={read:async()=>structuredClone(current)}
 await refreshDeployment({store,recipes:[recipe()],outDir:dir})
 current.state.withdrawn.old={reason:'withdrawn'};current.commit='new'
 const result=await refreshDeployment({store,recipes:[recipe()],outDir:dir});assert.equal(result.stateCommit,'new');assert.equal(JSON.parse(await readFile(path.join(dir,'catalog.json'))).packages.length,0)
})
test('namespace wrapper can drop back to the invoking runner user before executing verification',async t=>{
 if(process.platform==='win32')return
 const dir=await temporary(t),r=await runCommand({argv:[process.execPath,fileURLToPath(new URL('../isolation/linux.mjs',import.meta.url)),'--run','offline','--as-user',String(process.getuid()),String(process.getgid()),process.execPath,'-e','console.log(process.getuid())'],cwd:dir,env:await isolatedEnv(dir),logFile:path.join(dir,'uid.log')})
 assert.equal(r.exitCode,0,r.output);assert.equal(+r.output.trim(),process.getuid())
})
