import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm,writeFile,readFile} from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import {makeFixturePackage} from '../fixtures/package.mjs'
const api=await import('../core/package-metadata.mjs').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return{};throw e})
test('package metadata binds actual payload without self referencing its own hashes',async t=>{
 assert.equal(typeof api.writePackageMetadata,'function');const dir=await mkdtemp(path.join(os.tmpdir(),'depot-meta-'));t.after(()=>rm(dir,{recursive:true,force:true}));const root=await makeFixturePackage(dir,{archive:false});const m=await api.writePackageMetadata(root,{task:{source:{repository:'owner/repo',commit:'a'.repeat(40)},target:'macos-arm64',host:{version:'0.2.0-rc.2',node:'26.9.0'},buildKey:'b'.repeat(64)},recipe:{id:'fixture',hostRange:'^0.2.0-rc.2',probes:{native:[]}}});assert.ok(m.filesIndex.some(x=>x.path==='package.json'));assert.ok(!m.filesIndex.some(x=>x.path==='depot-files.json'||x.path==='depot-manifest.json'));await api.verifyPackageMetadata(root);await writeFile(path.join(root,'lib/index.js'),'tampered');await assert.rejects(()=>api.verifyPackageMetadata(root),{code:'INTEGRITY_MISMATCH'})
})
