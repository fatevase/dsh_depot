import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import {mkdir,writeFile,readFile,symlink,access} from 'node:fs/promises'
import {fixture} from './manager-helpers.mjs'
import {createOperationPlan} from '../core/plans.mjs'
import {executePlan} from '../core/operations.mjs'
test('normal planning never traverses unrelated installed dependencies',async t=>{
 const f=await fixture(t),outside=path.join(f.dir,'unrelated');await mkdir(outside);await writeFile(path.join(outside,'keep'),'data')
 await symlink(outside,path.join(f.profile,'node_modules/unrelated'),'dir')
 const plan=await createOperationPlan({host:f.host,inspection:f.inspection,action:'install'})
 assert.equal(plan.execution,'dsh-cli');assert.equal(plan.recoveryBytes,0)
})
function directAdapter(f,{fail=false}={}){return{async isRunning(){return false},async applyDirect(host,action){
 const p=JSON.parse(await readFile(path.join(f.profile,'package.json')));p.dependencies[action.packageName]='1.0.0';await writeFile(path.join(f.profile,'package.json'),JSON.stringify(p))
 await mkdir(path.join(f.profile,'node_modules',action.packageName),{recursive:true});await writeFile(path.join(f.profile,'node_modules',action.packageName,'package.json'),JSON.stringify({name:action.packageName,version:'1.0.0'}))
 if(fail)throw Object.assign(Error('DSH returned failure'),{code:'DSH_INSTALL_FAILED'})
}}}
test('normal execution calls DSH directly without making a dependency backup',async t=>{
 const f=await fixture(t),storeDir=path.join(f.dir,'state'),plan=await createOperationPlan({host:f.host,inspection:f.inspection,action:'install'})
 const op=await executePlan(plan,{host:f.host,adapter:directAdapter(f),storeDir})
 assert.equal(op.state,'awaiting_reload');assert.equal(op.snapshotId,null)
 assert.equal(op.activationNonce,undefined);assert.equal(typeof op.reloadNonce,'string')
 await assert.rejects(access(path.join(storeDir,'snapshots')),{code:'ENOENT'})
 assert.equal(await readFile(path.join(f.profile,'node_modules/old/index.js'),'utf8'),'old content')
})
test('a failed direct install reports failure without claiming a rollback',async t=>{
 const f=await fixture(t),plan=await createOperationPlan({host:f.host,inspection:f.inspection,action:'install'})
 const op=await executePlan(plan,{host:f.host,adapter:directAdapter(f,{fail:true}),storeDir:path.join(f.dir,'state')})
 assert.equal(op.state,'failed');assert.equal(op.result.restored,undefined);assert.equal(op.error.code,'DSH_INSTALL_FAILED')
 assert.equal(JSON.parse(await readFile(path.join(f.profile,'package.json'))).dependencies['new-plugin'],'1.0.0')
})
test('DSH CLI uses literal offline add/remove arguments and the target home',async t=>{
 const f=await fixture(t),{applyDshCli}=await import('../adapters/dsh-cli.mjs'),root=path.join(f.dir,'dsh'),record=path.join(f.profile,'argv.json')
 await mkdir(path.join(root,'lib'),{recursive:true})
 await writeFile(path.join(root,'lib/bin.js'),`exports.runCli=async(options)=>{require('node:fs').writeFileSync(${JSON.stringify(record)},JSON.stringify({argv:process.argv.slice(2),home:process.env.DSH_HOME,options:options??{}}))}`)
 const host={...f.host,dshRoot:root,nodePath:process.execPath,home:f.dir,capabilities:{writeSession:true,requiresExit:false},launch:{args:[path.join(root,'lib/bin.js'),'--profile','web']}}
 for(const action of ['install','remove']){
  // This carrier fixture runs under elevated Windows CI; ownership policy is tested separately.
  await applyDshCli(host,{action,path:path.join(f.dir,'space ; literal.tgz'),packageName:'new-plugin',storeDir:path.join(f.dir,'logs')},{ownershipCheck:async()=>{}})
  const observed=JSON.parse(await readFile(record));assert.equal(observed.home,f.dir);assert.deepEqual(observed.argv.slice(0,3),['plugin','--profile','web'])
  assert.deepEqual(observed.options,{})
  assert.ok(observed.argv.includes('--config.trust-lockfile=true'),'the actual DSH CLI must always receive the pure-offline policy even without an installed snapshot')
  assert.ok(!observed.argv.some(a=>/store-dir|auto-install-peers|manage-package-manager/.test(a)))
  if(action==='remove'){assert.ok(observed.argv.includes('--config.offline=true'));assert.ok(!observed.argv.includes('--offline'));assert.ok(!observed.argv.includes('--ignore-scripts'))}
  else assert.equal(observed.argv[4],path.join(f.dir,'space ; literal.tgz'))
 }
 await writeFile(path.join(f.profile,'pnpm-lock.yaml'),"lockfileVersion: '9.0'\nimporters: {}\n")
 await mkdir(path.join(f.profile,'node_modules/.pnpm'),{recursive:true})
 for(const snapshot of ['lockfileVersion: 9.0\nimporters: {}\nsettings: {autoInstallPeers: false}\n','[invalid']){
  await writeFile(path.join(f.profile,'node_modules/.pnpm/lock.yaml'),snapshot)
  await applyDshCli(host,{action:'install',path:f.inspection.archivePath,storeDir:path.join(f.dir,'logs')},{ownershipCheck:async()=>{}})
  assert.ok(JSON.parse(await readFile(record)).argv.includes('--config.trust-lockfile=true'),'snapshot drift must not silently remove the pure-offline CLI policy')
 }
})
test('direct installation preserves the host package-manager wrapper and ignores profile pnpm version',async t=>{
 const f=await fixture(t),{applyDshCli}=await import('../adapters/dsh-cli.mjs'),root=path.join(f.dir,'dsh'),record=path.join(f.profile,'carrier.json')
 await mkdir(path.join(root,'lib'),{recursive:true})
 await writeFile(path.join(root,'lib/bin.js'),`exports.runCli=async(options)=>{require('node:fs').writeFileSync(${JSON.stringify(record)},JSON.stringify(options))}`)
 await writeFile(path.join(f.profile,'node_modules/.modules.yaml'),'packageManager: pnpm@99.0.0\nstoreDir: /do-not-change-store\n')
 const packageManager={command:process.execPath,args:['/host/lock-recovery.mjs','/host/pnpm.cjs'],env:{ELECTRON_RUN_AS_NODE:'1',DSH_HOST_MARKER:'preserved'}}
 const host={...f.host,dshRoot:root,nodePath:process.execPath,home:f.dir,packageManager,capabilities:{writeSession:true},launch:{args:[path.join(root,'lib/bin.js'),'--profile','web']}}
 await applyDshCli(host,{action:'install',path:f.inspection.archivePath,packageName:'new-plugin',storeDir:path.join(f.dir,'logs')},{ownershipCheck:async()=>{}})
 const observed=JSON.parse(await readFile(record))
 assert.deepEqual(observed.packageManager,packageManager)
 assert.match(await readFile(path.join(f.profile,'node_modules/.modules.yaml'),'utf8'),/pnpm@99\.0\.0/)
})
test('Desktop installation and composition both use the installation harness entry',async t=>{
 const f=await fixture(t),{applyDshCli}=await import('../adapters/dsh-cli.mjs'),root=path.join(f.dir,'dsh'),resources=path.join(f.dir,'resources'),record=path.join(f.dir,'harness.jsonl')
 await mkdir(resources);await mkdir(path.join(root,'lib'),{recursive:true})
 await writeFile(path.join(root,'lib/bin.js'),"throw Error('must use Desktop harness')")
 const harness=path.join(resources,'harness-node-entry.mjs')
 await writeFile(harness,`import fs from 'node:fs';fs.appendFileSync(${JSON.stringify(record)},JSON.stringify({argv:process.argv.slice(2),entry:process.env.DSH_DESKTOP_PNPM_ENTRY,runner:process.env.DSH_DESKTOP_PNPM_RUNNER})+'\\n')`)
 const host={...f.host,kind:'official-desktop',desktop:{supported:true,resources},dshRoot:root,nodePath:process.execPath,home:f.dir,capabilities:{writeSession:true},runtimeEnv:{DSH_DESKTOP_PNPM_ENTRY:'/host/pnpm.cjs',DSH_DESKTOP_PNPM_RUNNER:'/host/pnpm-runner.mjs'},launch:{args:[harness,path.join(root,'lib/bin.js'),'--profile','web']}}
 await applyDshCli(host,{action:'install',packageName:'new-plugin',path:f.inspection.archivePath,storeDir:path.join(f.dir,'logs')},{ownershipCheck:async()=>{}})
 const rows=(await readFile(record,'utf8')).trim().split('\n').map(JSON.parse)
 assert.equal(rows.length,2);assert.equal(rows[0].argv[1],'plugin');assert.equal(rows[1].argv.at(-1),'--dump-config')
 assert.ok(rows.every(r=>r.entry==='/host/pnpm.cjs'&&r.runner==='/host/pnpm-runner.mjs'))
})
test('a direct batch installs through DSH while the host is running',async t=>{
 const f=await fixture(t),{createBatch,startBatch,resumeBatch}=await import('../core/batches.mjs'),storeDir=path.join(f.dir,'state')
 f.host.capabilities.requiresExit=true
 const batch=await createBatch({host:f.host,inspections:[f.inspection],ownerId:'u',storeDir});assert.equal(batch.requiresExit,false)
 await startBatch(batch.batchId,{host:f.host,storeDir});const adapter=directAdapter(f);adapter.isRunning=async()=>{throw Error('Do not require host exit')}
 assert.equal((await resumeBatch(batch.batchId,{host:f.host,adapter,storeDir})).state,'awaiting_reload')
})
test('a legacy queued plan upgrades to direct installation without scanning dependencies',async t=>{
 const f=await fixture(t),storeDir=path.join(f.dir,'state'),plan=await createOperationPlan({host:f.host,inspection:f.inspection,action:'install',execution:'snapshot'})
 delete plan.execution
 const outside=path.join(f.dir,'outside');await mkdir(outside);await symlink(outside,path.join(f.profile,'node_modules/linked'),'dir')
 const op=await executePlan(plan,{host:f.host,adapter:directAdapter(f),storeDir})
 assert.equal(op.state,'awaiting_reload');assert.equal(op.plan.execution,'dsh-cli');assert.equal(op.snapshotId,null)
})
test('a new install request repairs a missing package instead of reusing an old receipt',async t=>{
 const f=await fixture(t),storeDir=path.join(f.dir,'state'),adapter=directAdapter(f),{rm}=await import('node:fs/promises')
 const first=await createOperationPlan({host:f.host,inspection:f.inspection,action:'install'});await executePlan(first,{host:f.host,adapter,storeDir})
 await rm(path.join(f.profile,'node_modules/new-plugin'),{recursive:true})
 const next=await createOperationPlan({host:f.host,inspection:f.inspection,action:'install'}),repaired=await executePlan(next,{host:f.host,adapter,storeDir})
 assert.equal(repaired.planId,next.planId);await access(path.join(f.profile,'node_modules/new-plugin/package.json'))
})
test('legacy batches with a pending active item migrate the whole remaining batch to direct mode',async t=>{
 const f=await fixture(t),{createBatch,startBatch,resumeBatch}=await import('../core/batches.mjs'),storeDir=path.join(f.dir,'state')
 const batch=await createBatch({host:f.host,inspections:[f.inspection],ownerId:'u',storeDir});await startBatch(batch.batchId,{host:f.host,storeDir})
 const file=path.join(storeDir,'batches',batch.batchId+'.json'),b=JSON.parse(await readFile(file));delete b.execution
 b.activePlan=await createOperationPlan({host:f.host,inspection:f.inspection,action:'install',execution:'snapshot'});delete b.activePlan.execution
 await writeFile(file,JSON.stringify(b))
 const result=await resumeBatch(batch.batchId,{host:f.host,adapter:directAdapter(f),storeDir,quiesced:true})
 assert.equal(result.state,'awaiting_reload');assert.equal(JSON.parse(await readFile(file)).execution,'dsh-cli')
})
test('normal installation never requires stopping the running DSH',async t=>{
 const f=await fixture(t);f.host.capabilities.requiresExit=true
 const plan=await createOperationPlan({host:f.host,inspection:f.inspection,action:'install'}),adapter=directAdapter(f)
 adapter.isRunning=async()=>{throw Error('Normal installation must use DSH locking, not process exit checks')}
 assert.equal(plan.requiresExit,false)
 assert.equal((await executePlan(plan,{host:f.host,adapter,storeDir:path.join(f.dir,'state')})).state,'awaiting_reload')
})
