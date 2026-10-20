import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import fs from 'node:fs/promises'
import {syncBuiltinESMExports} from 'node:module'
import {randomBytes} from 'node:crypto'
import {collectExportGraph} from '../core/export-dependencies.mjs'
import {createExportService} from '../core/exports.mjs'
import {bundleFingerprint} from '../core/export-source.mjs'
import {atomicJson,readJson} from '../core/files.mjs'
import {exportFixture} from './manager-export-helpers.mjs'
async function waitFor(fn){for(let i=0;i<400;i++){const value=await fn();if(value)return value;await new Promise(r=>setTimeout(r,10))}throw Error('condition timeout')}
test('root and dependency manifests must describe the exact collected bytes',async t=>{
 for(const nested of [false,true]){
  const f=await exportFixture(t),target=nested?path.join(f.root,'node_modules/child'):f.root
  if(nested){await fs.mkdir(target,{recursive:true});await atomicJson(path.join(f.root,'package.json'),{name:'fixture',version:'1.0.0',dependencies:{child:'1.0.0'}});await atomicJson(path.join(target,'package.json'),{name:'child',version:'1.0.0'})}
  const file=path.join(await fs.realpath(target),'package.json'),original=fs.readFile;let changed=false
  fs.readFile=async function(name,...args){const bytes=await original.call(this,name,...args);if(String(name)===file&&!changed){changed=true;await atomicJson(file,{...JSON.parse(bytes),dependencies:{missing:'1.0.0'}})}return bytes};syncBuiltinESMExports()
  try{await assert.rejects(collectExportGraph({source:{root:f.root},host:f.host}),{code:'SOURCE_CHANGED'})}finally{fs.readFile=original;syncBuiltinESMExports()}
 }
})
test('a peer from another installed context cannot silently become a different host library',async t=>{
 const f=await exportFixture(t),library=path.join(f.dir,'host/node_modules/common'),actual=path.join(f.root,'node_modules/common');for(const [dir,version]of [[library,'1.0.0'],[actual,'2.0.0']]){await fs.mkdir(dir,{recursive:true});await atomicJson(path.join(dir,'package.json'),{name:'common',version})}
 await atomicJson(path.join(f.root,'package.json'),{name:'fixture',version:'1.0.0',peerDependencies:{common:'*'}})
 await assert.rejects(collectExportGraph({source:{root:f.root},host:{...f.host,dshRoot:path.join(f.dir,'host')}}),{code:'PEER_CONTEXT_MISMATCH'})
})
test('download lease and pruning coordinate across service instances',async t=>{
 const f=await exportFixture(t),a=createExportService(f),b=createExportService(f);t.after(async()=>{await a.dispose();await b.dispose()})
 const job=await a.create({packageName:'fixture',installedFingerprint:bundleFingerprint(f.bundle)});await waitFor(async()=>(await a.status(job.exportId)).state==='ready')
 const dl=await a.openDownload(job.exportId);await b.prune(Date.now()+86400001);assert.equal((await a.status(job.exportId)).state,'ready');let size=0;for await(const c of dl.stream)size+=c.length;await dl.release();assert.ok(size>0)
 await b.prune(Date.now()+86400001);assert.equal((await a.status(job.exportId)).state,'expired')
})
test('foreign-instance cancellation is acknowledged by the worker without later payload resurrection',async t=>{
 const f=await exportFixture(t);await fs.writeFile(path.join(f.root,'large.bin'),randomBytes(16*1024*1024));const a=createExportService(f),b=createExportService(f);t.after(async()=>{await a.dispose();await b.dispose()})
 const job=await a.create({packageName:'fixture',installedFingerprint:bundleFingerprint(f.bundle)});await waitFor(async()=>(await a.status(job.exportId)).state==='collecting');await b.cancel(job.exportId)
 await waitFor(async()=>(await readJson(path.join(f.dir,'exports',job.exportId,'job.json'))).running===false);assert.deepEqual(await fs.readdir(path.join(f.dir,'exports',job.exportId)),['job.json']);assert.equal((await a.status(job.exportId)).state,'cancelled')
})
test('expiration runs while the page is closed and stops when disposed',async t=>{
 const f=await exportFixture(t),a=createExportService({...f,cleanupIntervalMs:20});t.after(()=>a.dispose());const job=await a.create({packageName:'fixture',installedFingerprint:bundleFingerprint(f.bundle)});await waitFor(async()=>(await a.status(job.exportId)).state==='ready')
 const file=path.join(f.dir,'exports',job.exportId,'job.json'),record=await readJson(file);record.expiresAt=Date.now()-1;await atomicJson(file,record)
 await waitFor(async()=>(await a.status(job.exportId)).state==='expired');await a.dispose()
})
test('host core dependencies also validate the installed source instance',async t=>{
 const f=await exportFixture(t),root=path.join(f.root,'node_modules/@deepseek-ai/dsh-app-boot');await fs.mkdir(root,{recursive:true});await atomicJson(path.join(root,'package.json'),{name:'@deepseek-ai/dsh-app-boot',version:'0.2.0-rc.3'});await atomicJson(path.join(f.root,'package.json'),{name:'fixture',version:'1.0.0',dependencies:{'@deepseek-ai/dsh-app-boot':'0.2.0-rc.2'}})
 await assert.rejects(collectExportGraph({source:{root:f.root},host:f.host}),{code:'PEER_CONTEXT_MISMATCH'})
})
test('disposing another service instance does not terminate this instance export',async t=>{
 const f=await exportFixture(t),a=createExportService(f),b=createExportService(f);t.after(()=>a.dispose());const job=await a.create({packageName:'fixture',installedFingerprint:bundleFingerprint(f.bundle)});await b.dispose();await waitFor(async()=>(await a.status(job.exportId)).state==='ready')
})
