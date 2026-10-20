import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,rm,writeFile,readFile} from 'node:fs/promises'
import {execFileSync} from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import * as tar from 'tar'
import {fileHash} from '../core/files.mjs'
import {verifyBundle} from '../bootstrap/toolkit.mjs'
const api=await import('../build-bootstrap.mjs').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return{};throw e})
test('lite bundle is self-contained and binds the exact manager bytes',async t=>{
 assert.equal(typeof api.buildBootstrap,'function');const dir=await mkdtemp(path.join(os.tmpdir(),'depot-bundle-'));t.after(()=>rm(dir,{recursive:true,force:true}));const manager=path.join(dir,'manager.tgz');await writeFile(manager,'fixture only');const receipt=await api.buildBootstrap({target:'macos-arm64',flavor:'lite',managerArchive:manager,output:dir});assert.match(receipt.fileName,/macos-arm64-lite/);assert.equal(receipt.runtimeDigest,null);const entries=[];await tar.t({file:receipt.path,onReadEntry:e=>entries.push(e.path)});assert.ok(entries.some(x=>x.endsWith('/core.mjs')));assert.ok(entries.some(x=>x.endsWith('/manager.tgz')));assert.ok(entries.some(x=>x.endsWith('/settings.json')));assert.ok(!entries.some(x=>x.includes('node_modules')))
})
test('Windows full bundle extracts as a ZIP with program runtime CMD and instructions intact',async t=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'depot-windows-zip-'));t.after(()=>rm(dir,{recursive:true,force:true}))
 const manager=path.join(dir,'manager.tgz'),runtimeArchive=path.join(dir,'node-fixture.zip'),python=process.platform==='win32'?'python':'python3'
 await writeFile(manager,'manager fixture')
 execFileSync(python,['-c',"import zipfile,sys\nwith zipfile.ZipFile(sys.argv[1],'w') as z:\n z.writestr('node-fixture/node.exe',b'runtime fixture')\n z.writestr('node-fixture/LICENSE',b'license fixture')",runtimeArchive])
 const receipt=await api.buildBootstrap({target:'win32-x64',flavor:'full',managerArchive:manager,output:dir,runtimeArchive,runtimeLock:{targets:{'win32-x64':{sha256:await fileHash(runtimeArchive),archiveRoot:'node-fixture',nodeEntry:'node.exe',licenseEntry:'LICENSE'}}}})
 assert.ok(receipt.fileName.endsWith('.zip'),'Windows bundle must be directly extractable as ZIP')
 const extracted=path.join(dir,'extracted');await mkdir(extracted)
 execFileSync(python,['-c',"import zipfile,sys\nwith zipfile.ZipFile(sys.argv[1]) as z:z.extractall(sys.argv[2])",receipt.path,extracted])
 const root=path.join(extracted,receipt.fileName.slice(0,-4));await verifyBundle(root,{target:'win32-x64'})
 assert.equal(await readFile(path.join(root,'runtime/node.exe'),'utf8'),'runtime fixture')
 for(const file of ['core.mjs','install.cmd','README.txt','manager.tgz','settings.json'])assert.ok((await readFile(path.join(root,file))).length>0)
 assert.equal(await fileHash(path.join(root,'manager.tgz')),await fileHash(manager))
 assert.equal(JSON.parse(await readFile(path.join(root,'bundle.json'))).packageManagers,undefined)
 await assert.rejects(readFile(path.join(root,'package-managers.tgz')),{code:'ENOENT'})
})
