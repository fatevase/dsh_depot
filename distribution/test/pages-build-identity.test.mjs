import test from 'node:test'
import assert from 'node:assert/strict'
const mod=await import('../pages-build-identity.mjs').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e})
test('each Pages artifact receives a real commit on the separate deployment branch',async()=>{
 assert.equal(typeof mod.createPagesBuildIdentity,'function')
 const calls=[],github={request:async(endpoint,options={})=>{
  calls.push({endpoint,...options})
  if(endpoint.endsWith('/git/ref/heads/pages-builds'))return {data:{object:{sha:'b'.repeat(40)}}}
  if(endpoint.endsWith('/git/trees'))return {data:{sha:'d'.repeat(40)}}
  if(endpoint.endsWith('/git/commits'))return {data:{sha:'e'.repeat(40)}}
  return {data:{}}
 }}
 const id=await mod.createPagesBuildIdentity({github,repository:'owner/repo',sourceSha:'a'.repeat(40),runId:'42',runAttempt:'1',artifactId:123})
 assert.equal(id,'e'.repeat(40))
 assert.equal(calls.find(c=>c.endpoint.endsWith('/git/commits')).body.parents[0],'b'.repeat(40))
 const record=JSON.parse(calls.find(c=>c.endpoint.endsWith('/git/trees')).body.tree[0].content)
 assert.equal(calls.find(c=>c.endpoint.endsWith('/git/trees')).body.base_tree,undefined)
 assert.equal(record.artifactId,123);assert.equal(record.sourceSha,'a'.repeat(40))
 assert.equal(calls.at(-1).endpoint,'/repos/owner/repo/git/refs/heads/pages-builds')
 assert.equal(calls.at(-1).body.force,false)
 assert.ok(!calls.some(c=>c.endpoint.endsWith('/heads/main')))
})
test('first deployment creates only the deployment ref; permission failures do not masquerade as missing refs',async()=>{
 for(const status of [404,403]){
  const mutations=[],github={request:async(endpoint,options={})=>{
   if(endpoint.endsWith('/git/ref/heads/pages-builds'))throw Object.assign(Error('ref'),{status})
   mutations.push({endpoint,...options});return {data:{sha:'e'.repeat(40)}}
  }}
  const run=()=>mod.createPagesBuildIdentity({github,repository:'owner/repo',sourceSha:'a'.repeat(40),runId:'42',runAttempt:'1',artifactId:123})
  if(status===403){await assert.rejects(run(),/ref/);assert.equal(mutations.length,0)}
  else{await run();assert.equal(mutations.at(-1).body.ref,'refs/heads/pages-builds');assert.deepEqual(mutations.find(c=>c.endpoint.endsWith('/git/commits')).body.parents,[])}
 }
})
