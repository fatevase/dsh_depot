import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { Github } from '../lib/github.mjs'
import { discover } from '../lib/discover.mjs'
import { recipe, sha } from './helpers.mjs'
async function api(t,routes){const server=createServer((req,res)=>{const reply=routes[req.url];res.writeHead(reply?.status??200,{'content-type':'application/json',...(reply?.headers??{})});res.end(JSON.stringify(reply?.body??{}))});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));return new Github({baseUrl:`http://127.0.0.1:${server.address().port}`,retries:0})}
const content=text=>({body:{encoding:'base64',content:Buffer.from(text).toString('base64')}})
test('large frozen state files use the Git blob when the Contents API omits inline content',async t=>{
 const text='state larger than the inline API limit',blob=sha('c')
 const git=await api(t,{[`/repos/fixture/plugin/contents/state.json?ref=${sha('a')}`]:{body:{encoding:'none',content:'',sha:blob}},[`/repos/fixture/plugin/git/blobs/${blob}`]:content(text)})
 assert.equal(await git.text('fixture/plugin','state.json',sha('a')),text)
})
test('discovery freezes annotated tags, reads identity and records lock digests',async t=>{
 const git=await api(t,{'/repos/fixture/plugin/tags?per_page=100&page=1':{body:[{name:'v1.0.0',commit:{sha:sha('a')}}]},[`/repos/fixture/plugin/commits/${sha('a')}`]:{body:{sha:sha('a')}},[`/repos/fixture/plugin/contents/package.json?ref=${sha('a')}`]:content(JSON.stringify({name:'dsh-fixture',version:'1.0.0',repository:'https://github.com/fixture/plugin',peerDependencies:{'@deepseek-ai/dsh':'^0.2.0-rc.1'}})),[`/repos/fixture/plugin/contents/package-lock.json?ref=${sha('a')}`]:content('{}')})
 const d=await discover({recipes:[recipe()],previous:{},github:git,candidateFeeds:[]});assert.equal(d.sources[0].commit,sha('a'));assert.match(d.sources[0].lockDigests['package-lock.json'],/^[a-f0-9]{64}$/);assert.equal(d.errors.length,0)
})
test('fetch errors preserve previous observations and do not count as a successful check',async t=>{const git=await api(t,{'/repos/fixture/plugin/tags?per_page=100&page=1':{status:503,body:{message:'unavailable'}}});const previous={sources:[{recipeId:'fixture',ref:'v1',commit:sha('a')}]};const d=await discover({recipes:[recipe()],previous,github:git,candidateFeeds:[]});assert.equal(d.sources[0].commit,sha('a'));assert.equal(d.errors.length,1);assert.equal(d.complete,false)})
test('GitHub retries transient responses at most twice and supports cached 304',async t=>{let count=0;const server=createServer((req,res)=>{count++;res.writeHead(count===1?200:304,{'content-type':'application/json',etag:'x'});res.end(count===1?'[1]':'')});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));const git=new Github({baseUrl:`http://127.0.0.1:${server.address().port}`});assert.deepEqual((await git.request('/same')).data,[1]);assert.deepEqual((await git.request('/same')).data,[1]);assert.equal(count,2)})
test('explicit branch tracking accepts a new commit while immutable tags reject movement',async t=>{
 const routes={'/repos/fixture/plugin/commits/main':{body:{sha:sha('b')}},[`/repos/fixture/plugin/contents/package.json?ref=${sha('b')}`]:content(JSON.stringify({name:'dsh-fixture',version:'1.0.1'})),[`/repos/fixture/plugin/contents/package-lock.json?ref=${sha('b')}`]:content('{}')}
 const git=await api(t,routes),r=recipe({channel:{type:'branch',ref:'main'}}),previous={sources:[{recipeId:'fixture',repository:'fixture/plugin',ref:'main',commit:sha('a')}]}
 const result=await discover({recipes:[r],previous,github:git});assert.equal(result.sources[0].commit,sha('b'));assert.equal(result.sources[0].error,undefined)
})
test('transient 503 retries twice and exhausted retries stop',async t=>{
 let calls=0;const s=createServer((req,res)=>{calls++;res.writeHead(503);res.end('{}')});await new Promise(r=>s.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>s.close(r)));const git=new Github({baseUrl:`http://127.0.0.1:${s.address().port}`});await assert.rejects(git.request('/retry'));assert.equal(calls,3)
})
test('moved tags preserve the old commit and unknown topic repositories stay candidates',async t=>{
 const git=await api(t,{'/repos/fixture/plugin/tags?per_page=100&page=1':{body:[{name:'v1.0.0',commit:{sha:sha('b')}}]},[`/repos/fixture/plugin/commits/${sha('b')}`]:{body:{sha:sha('b')}},'/search/repositories?q=topic%3Adsh-plugin&per_page=100&page=1':{body:{items:[{full_name:'new/plugin'}]}}})
 const d=await discover({recipes:[recipe()],previous:{sources:[{recipeId:'fixture',repository:'fixture/plugin',ref:'v1.0.0',commit:sha('a')}]},github:git,candidateFeeds:[{type:'github-topic'}]});assert.equal(d.sources[0].commit,sha('a'));assert.equal(d.sources[0].error.code,'source_conflict');assert.equal(d.candidates[0].status,'needs_recipe');assert.equal(d.sources.some(s=>s.repository==='new/plugin'),false)
})
test('same npm name from a different declared repository is rejected',async t=>{
 const git=await api(t,{'/repos/fixture/plugin/tags?per_page=100&page=1':{body:[{name:'v1.0.0',commit:{sha:sha('a')}}]},[`/repos/fixture/plugin/commits/${sha('a')}`]:{body:{sha:sha('a')}},[`/repos/fixture/plugin/contents/package.json?ref=${sha('a')}`]:content(JSON.stringify({name:'dsh-fixture',version:'1.0.0',repository:'wrong/repository'}))})
 const d=await discover({recipes:[recipe()],github:git});assert.equal(d.sources.length,0);assert.match(d.errors[0].message,/identity mismatch/)
})
