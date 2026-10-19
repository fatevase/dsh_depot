import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {createHash} from 'node:crypto'
const mod=await import('../manager/ci.mjs').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return{};throw e})
test('manager bootstrap cannot publish under ordinary allowUnverified policy',()=>{assert.equal(typeof mod.assembleManagerPublication,'function');const p=mod.assembleManagerPublication([{target:'win32-x64',allowUnverified:true,verification:{status:'unverified'},assets:[{fileName:'bad.tgz'}]}]);assert.deepEqual(p.assets,[]);assert.equal(p.blocked.length,1)})
test('only complete verified matching assets enter the separate manager catalog',()=>{const p=mod.managerCatalogOf([{target:'linux-x64',flavor:'lite',fileName:'manager-lite.tgz',packageUrl:'https://github.com/fatevase/dsh_depot/releases/download/manager-test/manager-lite.tgz',sha256:'a'.repeat(64),compressedBytes:42,verification:{status:'unverified'}}],{});assert.equal(p.schemaVersion,1);assert.deepEqual(p.packages,[])})
test('published catalog is loaded by deployment rather than replaced with an empty one',async()=>{const {latestManagerCatalog}=await import('../lib/manager-catalog.mjs');const catalog={schemaVersion:1,packages:[]},url='https://github.com/fatevase/dsh_depot/releases/download/manager-123/manager-catalog.json';const result=await latestManagerCatalog({github:{list:async()=>[{tag_name:'manager-123',assets:[{name:'manager-catalog.json',browser_download_url:url}]}]},fetchImpl:async actual=>{assert.equal(actual,url);return Response.json(catalog)}});assert.deepEqual(result,catalog)})
test('explicit preview publishes complete bytes without promoting incomplete acceptance',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'manager-preview-'));t.after(()=>rm(directory,{recursive:true,force:true}))
 const managerHash=createHash('sha256').update('plugin').digest('hex'),bundleHash=createHash('sha256').update('installer').digest('hex')
 const manager={target:'linux-x64',fileName:'manager.tgz',path:path.join(directory,'manager.tgz'),sha256:managerHash,compressedBytes:6}
 const asset={version:'0.1.2',target:'linux-x64',flavor:'lite',fileName:'manager-lite.tgz',path:path.join(directory,'manager-lite.tgz'),sha256:bundleHash,managerSha256:managerHash,compressedBytes:9}
 await writeFile(manager.path,'plugin');await writeFile(asset.path,'installer')
 const receipt={target:'linux-x64',manager,assets:[asset],verification:{status:'unverified',packageSha256:managerHash,scope:[],evidence:{}}}
 assert.equal(mod.assembleManagerPublication([receipt]).assets.length,0)
 const plan=mod.assembleManagerPublication([receipt],{channel:'preview'});assert.equal(plan.assets.length,2);assert.equal(plan.assets[0].verification.status,'unverified');assert.ok(plan.assets[0].verification.missing.includes('script-install'))
 const {prepareReleaseFiles}=await import('../manager/publish-release.mjs'),{latestManagerCatalog}=await import('../lib/manager-catalog.mjs')
 const prepared=await prepareReleaseFiles(plan,{directory:path.join(directory,'release'),tag:'manager-preview-123'})
 const entry=prepared.catalog.packages[0];assert.equal(entry.version,'0.1.2');assert.equal(entry.channel,'preview');assert.equal(entry.verification.bundleSha256,bundleHash);assert.equal(entry.verification.validationLevel,'plugin-only');assert.match(entry.reportUrl,/manager-verification.json$/)
 const url='https://github.com/fatevase/dsh_depot/releases/download/manager-preview-123/manager-catalog.json'
 const loaded=await latestManagerCatalog({github:{list:async()=>[{prerelease:true,tag_name:'manager-preview-123',assets:[{name:'manager-catalog.json',browser_download_url:url}]}]},fetchImpl:async()=>Response.json(prepared.catalog)})
 assert.deepEqual(loaded.packages,prepared.catalog.packages)
 assert.match(await readFile(path.join(directory,'release/SHA256SUMS'),'utf8'),new RegExp(bundleHash))
 assert.equal(mod.assembleManagerPublication([{...receipt,fixture:true}],{channel:'preview'}).assets.length,0)
 assert.equal(mod.assembleManagerPublication([{...receipt,assets:[{...asset,managerSha256:'0'.repeat(64)}]}],{channel:'preview'}).assets.length,0)
 await writeFile(asset.path,'changed');await assert.rejects(prepareReleaseFiles(plan,{directory:path.join(directory,'bad'),tag:'manager-preview-124'}),/资产/)
})
