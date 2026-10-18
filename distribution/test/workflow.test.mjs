import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
test('workflow separates permission domains and aggregates failed or missing matrix jobs',async()=>{
 const w=JSON.parse(await readFile(new URL('../../.github/workflows/plugin-distribution.yml',import.meta.url)))
 assert.equal(w.on.schedule[0].cron,'23 3 * * *');assert.ok(w.on.workflow_dispatch);assert.equal(w.jobs.build.strategy['fail-fast'],false);assert.ok(w.jobs.build.if.includes('matrix'))
 assert.deepEqual(w.jobs.build.permissions,{contents:'read'});assert.ok(!JSON.stringify(w.jobs.build).includes('secrets.'));assert.ok(w.jobs.publish.if.includes('always()'));assert.ok(w.jobs.publish.if.includes('pull_request'));assert.equal(w.jobs.publish.permissions.contents,'write');assert.equal(w.jobs.pages.permissions['pages'],'write');assert.equal(w.jobs.pages.permissions['id-token'],'write')
 for(const job of Object.values(w.jobs))for(const step of job.steps??[]){if(step.uses)assert.match(step.uses,/@[a-f0-9]{40}$/);if(step.uses?.startsWith('actions/checkout'))assert.equal(step.with['persist-credentials'],false);if(step.uses?.startsWith('actions/upload-artifact'))assert.equal(step.with['retention-days'],2)}
 assert.ok(w.jobs.publish.concurrency);assert.equal(w.jobs.publish.concurrency['cancel-in-progress'],false)
})
