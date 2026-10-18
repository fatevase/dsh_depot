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
 assert.equal(w.on.schedule[0].cron,'23 3 * * *');assert.ok(w.on.workflow_dispatch);assert.equal(w.jobs.build.strategy['fail-fast'],false);assert.ok(w.jobs.build.if.includes('matrix'))
 assert.deepEqual(w.jobs.build.permissions,{contents:'read'});assert.ok(!JSON.stringify(w.jobs.build).includes('secrets.'));assert.ok(w.jobs.publish.if.includes('always()'));assert.ok(w.jobs.publish.if.includes('pull_request'));assert.equal(w.jobs.publish.permissions.contents,'write');assert.equal(w.jobs.pages.permissions['pages'],'write');assert.equal(w.jobs.pages.permissions['id-token'],'write')
 for(const job of Object.values(w.jobs))for(const step of job.steps??[]){if(step.uses)assert.match(step.uses,/@[a-f0-9]{40}$/);if(step.uses?.startsWith('actions/checkout'))assert.equal(step.with['persist-credentials'],false);if(step.uses?.startsWith('actions/upload-artifact'))assert.equal(step.with['retention-days'],2)}
 assert.ok(w.jobs.publish.concurrency);assert.equal(w.jobs.publish.concurrency['cancel-in-progress'],false)
})
