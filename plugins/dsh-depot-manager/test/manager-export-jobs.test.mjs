import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import {mkdir,writeFile,rm} from 'node:fs/promises'
import {temporary} from './helpers.mjs'
import {atomicJson,readJson} from '../core/files.mjs'
import {createExportService} from '../core/exports.mjs'
import {bundleFingerprint} from '../core/export-source.mjs'
export async function exportFixture(t){const dir=await temporary(t),root=path.join(dir,'source');await mkdir(root);await writeFile(path.join(root,'package.json'),JSON.stringify({name:'fixture',version:'1.0.0',main:'index.js',dsh:{bundle:{patch:'cordis.patch.yml'}}}));await writeFile(path.join(root,'index.js'),'module.exports=42');await writeFile(path.join(root,'cordis.patch.yml'),'[]');const bundle={name:'fixture',version:'1.0.0',installed:true,enabled:true};return {dir,root,bundle,host:{hostId:'host1',dshRoot:dir,profileDir:dir,version:'0.2.0-rc.2',target:'macos-arm64',runtime:{node:'24.17.0',platform:'darwin',arch:'arm64',abi:'137',kind:'electron'}},ownerId:'owner1',storeDir:dir,listBundles:async()=>[bundle],resolveBundleDir:()=>root}}
async function terminal(service,id){for(let n=0;n<300;n++){const j=await service.status(id);if(['ready','failed','cancelled'].includes(j.state))return j;await new Promise(r=>setTimeout(r,20))}throw new Error('export timeout')}
test('real worker queue produces portable bytes, validates identity and keeps completed exports after source removal',async t=>{
 const f=await exportFixture(t),service=createExportService(f);t.after(()=>service.dispose())
 await assert.rejects(service.create({packageName:'fixture',installedFingerprint:'stale'}),{code:'HOST_CHANGED'})
 const a=await service.create({packageName:'fixture',installedFingerprint:bundleFingerprint(f.bundle)}),b=await service.create({packageName:'fixture',installedFingerprint:bundleFingerprint(f.bundle)})
 const done=await terminal(service,a.exportId);assert.equal(done.state,'ready',JSON.stringify(done));assert.equal((await terminal(service,b.exportId)).state,'ready')
 assert.equal(JSON.stringify(done).includes(f.root),false);assert.equal(done.downloadUrl,`/api/depot/export-download?id=${a.exportId}`)
 await rm(f.root,{recursive:true});const download=await service.openDownload(a.exportId);let size=0;for await(const c of download.stream)size+=c.length;download.release();assert.equal(size,done.compressedBytes)
})
test('cancel queued/running, restart interruption and expired-download leases are deterministic',async t=>{
 const f=await exportFixture(t),service=createExportService(f);t.after(()=>service.dispose())
 const a=await service.create({packageName:'fixture',installedFingerprint:bundleFingerprint(f.bundle)});await service.cancel(a.exportId);assert.equal((await terminal(service,a.exportId)).state,'cancelled')
 const b=await service.create({packageName:'fixture',installedFingerprint:bundleFingerprint(f.bundle)});assert.equal((await terminal(service,b.exportId)).state,'ready')
 const dl=await service.openDownload(b.exportId);await service.prune(Date.now()+86400001);assert.equal((await service.status(b.exportId)).state,'ready');dl.stream.destroy();dl.release();await service.prune(Date.now()+86400001);assert.equal((await service.status(b.exportId)).state,'expired')
 await service.dispose();const id='interrupted';await atomicJson(path.join(f.dir,'exports',id,'job.json'),{exportId:id,hostId:f.host.hostId,ownerId:f.ownerId,state:'packing',pid:999999999,createdAt:Date.now(),updatedAt:Date.now()})
 const restarted=createExportService(f);t.after(()=>restarted.dispose());assert.equal((await restarted.status(id)).error.code,'EXPORT_INTERRUPTED')
})
test('private job identity and non-ready downloads cannot be bypassed',async t=>{
 const f=await exportFixture(t),service=createExportService(f);t.after(()=>service.dispose())
 await atomicJson(path.join(f.dir,'exports','foreign','job.json'),{exportId:'foreign',hostId:'other',ownerId:f.ownerId,state:'ready'})
 await assert.rejects(service.status('foreign'),{code:'FORBIDDEN'});await assert.rejects(service.openDownload('foreign'),{code:'FORBIDDEN'})
 const job=await service.create({packageName:'fixture',installedFingerprint:bundleFingerprint(f.bundle)});await service.cancel(job.exportId);await assert.rejects(service.openDownload(job.exportId),{code:'EXPORT_NOT_READY'})
})
