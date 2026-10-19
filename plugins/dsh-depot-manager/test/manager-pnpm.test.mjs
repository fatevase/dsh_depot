import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
const build=await import('../build-pnpm.mjs').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return{};throw e})
const runtime=await import('../adapters/profile-pnpm.mjs').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return{};throw e})
test('offline tools select the existing profile pnpm major without changing its versioned store',async t=>{
 assert.equal(typeof build.buildPnpmArchive,'function');assert.equal(typeof runtime.resolveProfilePnpm,'function')
 const root=await mkdtemp(path.join(os.tmpdir(),'depot-pnpm-'));t.after(()=>rm(root,{recursive:true,force:true}))
 const packageManagers=await build.buildPnpmArchive(path.join(root,'package-managers.tgz'))
 const profile=path.join(root,'profile');await mkdir(path.join(profile,'node_modules'),{recursive:true});await writeFile(path.join(profile,'package.json'),'{"private":true}')
 for(const [major,suffix] of [[10,'v10'],[11,'v11']]){
  const store=path.join(root,'store-'+major,suffix);await mkdir(store,{recursive:true})
  await writeFile(path.join(profile,'node_modules/.modules.yaml'),JSON.stringify({packageManager:'pnpm@'+major+'.0.0',storeDir:store}))
  const selected=await runtime.resolveProfilePnpm({profileDir:profile,packageManager:{command:'must-not-use-global-pnpm'},runtime:{node:process.versions.node}},{toolkit:{root,nodePath:process.execPath,packageManagers},workDir:path.join(root,'work-'+major)})
  assert.equal(selected.version.split('.')[0],String(major));assert.equal(selected.storeDir,store);assert.equal(selected.command,process.execPath)
 }
})
