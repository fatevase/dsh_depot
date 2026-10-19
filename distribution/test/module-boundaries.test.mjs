import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile,mkdtemp,rm,writeFile} from 'node:fs/promises'
import {execFileSync} from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
const root=new URL('../../',import.meta.url)
test('standalone website build emits supplied catalogs without reading distribution state',async t=>{
 const pkg=JSON.parse(await readFile(new URL('web/package.json',root)))
 assert.equal(typeof pkg.scripts.build,'string')
 const dir=await mkdtemp(path.join(os.tmpdir(),'depot-web-build-'));t.after(()=>rm(dir,{recursive:true,force:true}))
 const catalog={schemaVersion:1,plugins:[],packages:[],latest:{},issues:[]},managerCatalog={schemaVersion:1,packages:[]}
 await writeFile(path.join(dir,'catalog.json'),JSON.stringify(catalog));await writeFile(path.join(dir,'manager.json'),JSON.stringify(managerCatalog))
 execFileSync(process.execPath,[fileURLToPath(new URL('web/build.mjs',root)),'--catalog',path.join(dir,'catalog.json'),'--manager-catalog',path.join(dir,'manager.json'),'--output',path.join(dir,'site')],{cwd:path.join(dir),stdio:'pipe'})
 assert.deepEqual(JSON.parse(await readFile(path.join(dir,'site/catalog.json'))),catalog)
 for(const name of ['index','plugins','plugin','guide','manager'])assert.match(await readFile(path.join(dir,'site',name+'.html'),'utf8'),/assets\/.*\.js/)
})
test('manager and pipeline consume the same metadata verifier without runtime cross imports',async t=>{
 const {writePackageMetadata,verifyPackageMetadata}=await import('../../packages/offline-format/package-metadata.mjs')
 const {makeFixturePackage}=await import('../../plugins/dsh-depot-manager/fixtures/package.mjs')
 const dir=await mkdtemp(path.join(os.tmpdir(),'depot-contract-'));t.after(()=>rm(dir,{recursive:true,force:true}))
 const content=await makeFixturePackage(dir,{archive:false})
 await writePackageMetadata(content,{task:{target:'macos-arm64',host:{version:'0.2.0-rc.2',node:'26.9.0'},source:{},buildKey:'fixture'},recipe:{id:'fixture',probes:{}}})
 assert.equal((await verifyPackageMetadata(content)).target,'macos-arm64')
 await writeFile(path.join(content,'tampered.txt'),'changed');await assert.rejects(()=>verifyPackageMetadata(content),{code:'INTEGRITY_MISMATCH'})
})
