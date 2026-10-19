import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm,writeFile} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as tar from 'tar'
const api=await import('../manager/build-bootstrap.mjs').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return{};throw e})
test('lite bundle is self-contained and binds the exact manager bytes',async t=>{
 assert.equal(typeof api.buildBootstrap,'function');const dir=await mkdtemp(path.join(os.tmpdir(),'depot-bundle-'));t.after(()=>rm(dir,{recursive:true,force:true}));const manager=path.join(dir,'manager.tgz');await writeFile(manager,'fixture only');const receipt=await api.buildBootstrap({target:'macos-arm64',flavor:'lite',managerArchive:manager,output:dir});assert.match(receipt.fileName,/macos-arm64-lite/);assert.equal(receipt.runtimeDigest,null);const entries=[];await tar.t({file:receipt.path,onReadEntry:e=>entries.push(e.path)});assert.ok(entries.some(x=>x.endsWith('/core.mjs')));assert.ok(entries.some(x=>x.endsWith('/manager.tgz')));assert.ok(!entries.some(x=>x.includes('node_modules')))
})
