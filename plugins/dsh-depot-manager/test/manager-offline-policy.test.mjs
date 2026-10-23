import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
const {offlineLockfileArgs}=await import('../adapters/offline-policy.mjs').catch(()=>({}))
const lock="lockfileVersion: '9.0'\nimporters:\n  .:\n    dependencies:\n      existing:\n        specifier: 1.0.0\n        version: 1.0.0\npackages:\n  existing@1.0.0:\n    resolution: {integrity: sha512-existing}\n"
async function fixture(t){const dir=await mkdtemp(path.join(os.tmpdir(),'depot-offline-policy-'));t.after(()=>rm(dir,{recursive:true,force:true}));await mkdir(path.join(dir,'node_modules/.pnpm'),{recursive:true});return dir}
test('offline operations reuse only a lockfile matching the installed snapshot, without scanning dependency trees',async t=>{
 assert.equal(typeof offlineLockfileArgs,'function');const dir=await fixture(t)
 await writeFile(path.join(dir,'pnpm-lock.yaml'),lock)
 await writeFile(path.join(dir,'node_modules/.pnpm/lock.yaml'),'# installed snapshot\n'+lock)
 assert.deepEqual(await offlineLockfileArgs(dir),['--config.trust-lockfile=true'])
 await writeFile(path.join(dir,'pnpm-lock.yaml'),lock.replace('sha512-existing','sha512-changed'))
 assert.deepEqual(await offlineLockfileArgs(dir),[])
})
test('missing or invalid installed lockfiles retain normal DSH checks; a custom virtual store is supported',async t=>{
 assert.equal(typeof offlineLockfileArgs,'function');const dir=await fixture(t)
 assert.deepEqual(await offlineLockfileArgs(dir),[])
 await writeFile(path.join(dir,'pnpm-lock.yaml'),lock)
 assert.deepEqual(await offlineLockfileArgs(dir),[])
 await writeFile(path.join(dir,'node_modules/.pnpm/lock.yaml'),'[invalid')
 assert.deepEqual(await offlineLockfileArgs(dir),[])
 await mkdir(path.join(dir,'custom virtual store'))
 await writeFile(path.join(dir,'node_modules/.modules.yaml'),'virtualStoreDir: ../custom virtual store\n')
 await writeFile(path.join(dir,'custom virtual store/lock.yaml'),lock)
 assert.deepEqual(await offlineLockfileArgs(dir),['--config.trust-lockfile=true'])
})
test('one-shot DSH service rechecks the snapshot after acquiring the public lock and preserves the host carrier',async t=>{
 const {runOfflinePackageCommand}=await import('../adapters/dsh-cli.mjs'),dir=await fixture(t)
 await writeFile(path.join(dir,'pnpm-lock.yaml'),lock);await writeFile(path.join(dir,'node_modules/.pnpm/lock.yaml'),lock)
 let locked=false,argsSeen,optionsSeen,changedWhileWaiting=true
 const input={dir,profile:'web',installAnchor:path.join(dir,'package.json'),args:['add','/local/package.tgz','--offline','--ignore-scripts'],packageManager:{command:'/host/node',args:['/host/runner','/host/pnpm'],env:{HOST_MARKER:'kept'}},env:{}}
 const services={atomic:{withFileLock:async(file,fn)=>{assert.equal(file,path.join(dir,'package.json'));if(changedWhileWaiting)await writeFile(path.join(dir,'pnpm-lock.yaml'),lock.replace('sha512-existing','sha512-changed'));locked=true;try{return await fn()}finally{locked=false}}},operations:{runProfilePnpm:async(ctx,args,opts)=>{assert.ok(locked);argsSeen=args;optionsSeen=opts;return{exitCode:0}}}}
 await runOfflinePackageCommand(input,{loadPublicServices:async()=>services})
 assert.ok(!argsSeen.includes('--config.trust-lockfile=true'),'a snapshot changed while waiting must not inherit a stale trust decision')
 changedWhileWaiting=false;await writeFile(path.join(dir,'pnpm-lock.yaml'),lock)
 await runOfflinePackageCommand(input,{loadPublicServices:async()=>services})
 assert.ok(argsSeen.includes('--config.trust-lockfile=true'));assert.deepEqual(optionsSeen.args,input.packageManager.args);assert.equal(optionsSeen.command,input.packageManager.command);assert.equal(optionsSeen.env.HOST_MARKER,'kept');assert.equal(optionsSeen.env.npm_config_offline,'true');assert.equal(optionsSeen.activateNewBundles,true)
})
