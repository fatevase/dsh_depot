import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp, mkdir, writeFile, readFile} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {campaignMatrix, summarizeCampaign, buildCandidate, campaignMarkdown} from '../lib/candidate-build.mjs'

const targets=['macos-arm64','linux-x64','win32-x64']
const entries=Array.from({length:99},(_,i)=>({repositoryId:i+1,repository:`owner/plugin-${i+1}`,ref:'main',packagePath:'.',buildScripts:[]}))
test('all 99 repositories receive exactly one task on each platform within the Actions matrix limit',()=>{
 const matrix=campaignMatrix({entries,targets,batchSize:5})
 assert.equal(matrix.include.length,60)
 const tasks=matrix.include.flatMap(job=>job.entries.map(entry=>`${entry.repositoryId}:${job.target}`))
 assert.equal(tasks.length,297);assert.equal(new Set(tasks).size,297)
 assert.ok(matrix.include.every(job=>job.entries.length<=5))
 assert.equal(campaignMatrix({entries,targets,batchSize:5},{batch:20,target:'win32-x64'}).include[0].entries.length,4)
 assert.throws(()=>campaignMatrix({entries,targets,batchSize:5},{batch:21}),/batch/i)
})
test('missing, failed and compiled receipts remain distinct; compilation never means offline verified',()=>{
 const plan={entries:entries.slice(0,2),targets}
 const receipts=targets.map(target=>({repositoryId:1,target,status:'compiled',verification:'not-run'}))
 receipts.push({repositoryId:2,target:targets[0],status:'failed',verification:'not-run',error:'dependency failure'})
 const report=summarizeCampaign(plan,receipts)
 assert.deepEqual(report.counts,{compiled:3,failed:1,missing:2})
 assert.equal(report.plugins[0].compiled,true);assert.equal(report.plugins[1].compiled,false)
 assert.throws(()=>summarizeCampaign(plan,[...receipts,receipts[0]]),/duplicate/i)
})
test('all-failure checklist fits GitHub issue limits and escapes log formatting',()=>{
 const plan={entries,targets},receipts=entries.flatMap(e=>targets.map(target=>({repositoryId:e.repositoryId,target,status:'failed',verification:'not-run',error:'|\n<script> `'.repeat(300)})))
 const markdown=campaignMarkdown(summarizeCampaign(plan,receipts),'https://github.com/owner/repo/actions/runs/1')
 assert.ok(markdown.length<60000)
 assert.ok(!markdown.includes('<script>'))
 assert.equal(markdown.split('- [ ]').length-1,99)
})
test('real dependency-free build produces a trial tgz and captures failed commands as receipts',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'depot-candidate-'))
 const source=path.join(dir,'source');await mkdir(source)
 await writeFile(path.join(source,'package.json'),JSON.stringify({name:'trial-fixture',version:'1.0.0',dsh:{bundle:{patch:'cordis.patch.yml'}},scripts:{build:'node build.mjs'},files:['lib','cordis.patch.yml']}))
 await writeFile(path.join(source,'build.mjs'),"import fs from 'node:fs';fs.mkdirSync('lib');fs.writeFileSync('lib/index.js','export default 1')")
 await writeFile(path.join(source,'cordis.patch.yml'),'fixture: {}')
 const entry={...entries[0],commit:'a'.repeat(40),npmName:'trial-fixture',buildScripts:['build']}
 const result=await buildCandidate(entry,{sourceDir:source,workDir:path.join(dir,'ok')})
 assert.equal(result.status,'compiled',result.error)
 assert.equal(result.verification,'not-run');assert.ok(result.artifact.sha256.match(/^[a-f0-9]{64}$/))
 assert.ok((await readFile(result.artifact.file)).length>0)
 const failed=await buildCandidate({...entry,buildScripts:['does-not-exist']},{sourceDir:source,workDir:path.join(dir,'bad')})
 assert.equal(failed.status,'failed');assert.match(failed.error,/script/i)
})
