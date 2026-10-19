import test from 'node:test'
import assert from 'node:assert/strict'
const mod=await import('../lib/pages-deployment.mjs').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e})
test('different artifacts at the same source commit create independent Pages deployments',async()=>{
 assert.equal(typeof mod.deployPages,'function')
 const bodies=[],statuses=[]
 const github={request:async(endpoint,options={})=>{
  if(options.method==='POST'){bodies.push(options.body);return {data:{id:options.body.pages_build_version,page_url:'https://example.github.io/depot/'}}}
  statuses.push(endpoint);return {data:{status:'succeed'}}
 }}
 for(const artifactId of [123,456])await mod.deployPages({github,repository:'owner/repo',sourceSha:'a'.repeat(40),runId:'42',runAttempt:'1',artifactId,oidcToken:'secret',wait:async()=>{}})
 assert.notEqual(bodies[0].pages_build_version,bodies[1].pages_build_version)
 assert.deepEqual(bodies.map(b=>b.artifact_id),[123,456])
 assert.ok(statuses[1].endsWith(bodies[1].pages_build_version))
})
test('Pages deployment waits for success and cancels on a failed or timed out status',async()=>{
 for(const outcome of ['deployment_failed','deployment_in_progress']){
  const calls=[],github={request:async(endpoint,options={})=>{calls.push(endpoint);return {data:options.method==='POST'?{id:'deployment-123',page_url:'https://example.github.io/'}:{status:outcome}}}}
  await assert.rejects(mod.deployPages({github,repository:'owner/repo',sourceSha:'a'.repeat(40),runId:'42',runAttempt:'1',artifactId:123,oidcToken:'secret',maxPolls:2,wait:async()=>{}}),/Pages/)
  assert.equal(calls.at(-1),'/repos/owner/repo/pages/deployments/deployment-123/cancel')
 }
})
