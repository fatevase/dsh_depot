import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, writeFile, unlink } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { temporary } from './helpers.mjs'
test('Windows autocrlf checkout preserves frozen lock and host bytes',async t=>{
 const dir=await temporary(t),git=(...args)=>execFileSync('git',['-C',dir,...args],{stdio:'pipe'})
 git('init','-q');git('config','core.autocrlf','true')
 const attributes=await readFile(new URL('../../.gitattributes',import.meta.url))
 await writeFile(path.join(dir,'.gitattributes'),attributes)
 for(const name of ['adapter.json','pnpm-lock.yaml'])await writeFile(path.join(dir,name),'frozen\nbytes\n')
 git('add','.');for(const name of ['adapter.json','pnpm-lock.yaml'])await unlink(path.join(dir,name))
 git('checkout-index','-a')
 for(const name of ['adapter.json','pnpm-lock.yaml'])assert.equal(await readFile(path.join(dir,name),'utf8'),'frozen\nbytes\n')
})
test('workflow separates permission domains and aggregates failed or missing matrix jobs',async()=>{
 const w=JSON.parse(await readFile(new URL('../../.github/workflows/plugin-distribution.yml',import.meta.url)))
 assert.equal(w.on.schedule[0].cron,'23 */6 * * *');assert.equal(w.concurrency['cancel-in-progress'],false);assert.ok(w.on.workflow_dispatch);assert.equal(w.jobs.build.strategy['fail-fast'],false);assert.ok(w.jobs.build.if.includes('matrix'))
 assert.deepEqual(w.jobs.build.permissions,{contents:'read'});assert.ok(!JSON.stringify(w.jobs.build).includes('secrets.'));assert.ok(w.jobs.publish.if.includes('always()'));assert.ok(w.jobs.publish.if.includes('pull_request'));assert.equal(w.jobs.publish.permissions.contents,'write');assert.equal(w.jobs.pages,undefined)
 for(const job of Object.values(w.jobs))for(const step of job.steps??[]){if(step.uses)assert.match(step.uses,/@[a-f0-9]{40}$/);if(step.uses?.startsWith('actions/checkout'))assert.equal(step.with['persist-credentials'],false);if(step.uses?.startsWith('actions/upload-artifact'))assert.equal(step.with['retention-days'],2)}
 assert.ok(w.jobs.build.steps.some(s=>s.run==='./distribution/isolation/prepare-windows.ps1'&&s.if==="matrix.target == 'win32-x64'"))
 assert.equal(w.jobs['windows-isolation-probe']['runs-on'],'windows-2025')
 assert.ok(w.jobs.publish.concurrency);assert.equal(w.jobs.publish.concurrency['cancel-in-progress'],false)
 assert.equal(w.jobs.pages,undefined)
})
test('website changes do not select either native build workflow',async()=>{
 for(const file of ['plugin-distribution','manager-distribution']){
  const w=JSON.parse(await readFile(new URL(`../../.github/workflows/${file}.yml`,import.meta.url)))
  for(const event of ['push','pull_request'])for(const changed of ['web/App.svelte','web/styles.css','web/build.mjs'])assert.ok(!(w.on[event]?.paths??[]).some(pattern=>path.matchesGlob(changed,pattern)),`${file} triggered by ${changed}`)
 }
 const w=JSON.parse(await readFile(new URL('../../.github/workflows/manager-distribution.yml',import.meta.url)))
 assert.ok(w.on.pull_request.paths.some(pattern=>path.matchesGlob('plugins/dsh-depot-manager/core/operations.mjs',pattern)))
})
test('only the website workflow owns Pages authority and uses trusted default-branch deployment code',async()=>{
 for(const file of ['plugin-distribution','manager-distribution']){
  const w=JSON.parse(await readFile(new URL(`../../.github/workflows/${file}.yml`,import.meta.url)))
  for(const job of Object.values(w.jobs))assert.equal(job.permissions?.pages,undefined)
 }
 const w=JSON.parse(await readFile(new URL('../../.github/workflows/web-pages.yml',import.meta.url)))
 assert.deepEqual(w.permissions,{})
 assert.deepEqual(w.jobs.preview.permissions,{contents:'read'})
 assert.ok(w.jobs.pages.steps.some(s=>s.run==='node distribution/deploy-site.mjs gate'))
 assert.ok(w.jobs.pages.if.includes('workflow_run.head_branch'))
 assert.ok(w.jobs.pages.if.includes('workflow_run.event'))
 assert.ok(w.jobs.pages.if.includes('default_branch'))
 assert.equal(w.jobs.pages.permissions.pages,'write')
 const checkout=w.jobs.pages.steps.find(s=>s.uses?.startsWith('actions/checkout@'))
 assert.equal(checkout.with.ref,'${{ github.event.repository.default_branch }}')
 assert.ok(!w.jobs.pages.steps.some(s=>s.uses?.startsWith('actions/download-artifact@')))
})
test('PR updates run once instead of duplicating native matrices on a branch push',async()=>{
 for(const name of ['web-pages','manager-distribution','plugin-distribution']){
  const w=JSON.parse(await readFile(new URL(`../../.github/workflows/${name}.yml`,import.meta.url)))
  assert.deepEqual(w.on.push.branches,['main'])
  assert.ok(w.on.pull_request)
 }
})
