import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import os from 'node:os'
import {mkdtemp,mkdir,writeFile,readFile,rm,realpath} from 'node:fs/promises'
import {desktopAt,locateInstallations} from '../adapters/locate.mjs'
import {desktopPackageManager,desktopPnpmEnvironment} from '../adapters/host-pnpm.mjs'
import {applyDshCli} from '../adapters/dsh-cli.mjs'

// Mirrors the downloaded official Windows ASAR and physical runtime layout.
async function fixture(t,platform='win32'){
 const root=await realpath(await mkdtemp(path.join(os.tmpdir(),'native-desktop-')));t.after(()=>rm(root,{recursive:true,force:true}))
 const app=path.join(root,platform==='darwin'?'Renamed Harness.app':'custom install with spaces'),resources=path.join(app,platform==='darwin'?'Contents/Resources':'resources')
 const executable=path.join(app,platform==='darwin'?'Contents/MacOS/DeepSeek Harness':'DeepSeek Harness.exe')
 const cli=path.join(resources,'runtime/cli/bin',platform==='win32'?'dsh.cmd':'dsh'),pnpm=path.join(resources,'runtime/primary-runtime/dependencies/pnpm/bin/pnpm.mjs')
 for(const p of [cli,pnpm,executable]){await mkdir(path.dirname(p),{recursive:true});await writeFile(p,'fixture, never execute')}
 const entries={'package.json':JSON.stringify({name:'@deepseek-ai/dsh-desktop',version:'0.2.1-rc.2'}),'dsh/node_modules/@deepseek-ai/dsh/package.json':JSON.stringify({name:'@deepseek-ai/dsh',version:'0.2.1-rc.2'}),'dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js':'// official entry fixture'}
 const tree={files:{}};let offset=0;const bodies=[]
 for(const [name,content]of Object.entries(entries)){let dir=tree;const parts=name.split('/');for(const p of parts.slice(0,-1))dir=dir.files[p]??=( {files:{}} );const body=Buffer.from(content);dir.files[parts.at(-1)]={offset:String(offset),size:body.length};bodies.push(body);offset+=body.length}
 const header=Buffer.from(JSON.stringify(tree)),block=Math.ceil((header.length+8)/4)*4,bytes=Buffer.alloc(block+8+offset)
 bytes.writeUInt32LE(4,0);bytes.writeUInt32LE(block,4);bytes.writeUInt32LE(block-4,8);bytes.writeUInt32LE(header.length,12);header.copy(bytes,16);Buffer.concat(bodies).copy(bytes,block+8)
 await writeFile(path.join(resources,'app.asar'),bytes)
 return{root,app,resources,executable,cli,pnpm}
}
for(const platform of ['win32','darwin'])test(`official ${platform} Desktop is recognized from directory, executable and CLI shim`,async t=>{
 const f=await fixture(t,platform)
 for(const input of [f.app,f.executable,f.cli]){
  const d=await desktopAt(input,{platform})
  assert.ok(d,'must recognize official package identity');assert.equal(d.layout,'bundled-cli');assert.equal(d.supported,true)
  assert.equal(d.executable,f.executable);assert.equal(d.profileName,'desktop');assert.equal(d.dshVersion,'0.2.1-rc.2')
  assert.equal(d.cliEntry,path.join(f.resources,'app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js'))
 }
})
test('incomplete official Desktop remains discoverable with a useful blocked reason',async t=>{
 const f=await fixture(t);await rm(f.pnpm)
 const d=await desktopAt(f.app,{platform:'win32'});assert.ok(d);assert.equal(d.supported,false);assert.equal(d.blockedReason,'DESKTOP_RUNTIME_INCOMPLETE')
})
test('running DeepSeek Harness contributes a nonstandard installation',async t=>{
 const f=await fixture(t,process.platform==='darwin'?'darwin':'win32')
 const found=await locateInstallations({env:{PATH:''},processes:[{pid:123456,executable:f.executable,command:`"${f.executable}"`}],userHome:f.root})
 assert.ok(found.desktop.some(d=>d.appPath===f.app))
})
test('native Desktop uses only its physical pnpm and its original launcher environment',async t=>{
 const f=await fixture(t),desktop={layout:'bundled-cli',resources:f.resources,runtimeRoot:path.join(f.resources,'app.asar/dsh')}
 const pm=await desktopPackageManager(desktop,{nodePath:f.executable})
 assert.deepEqual(pm.args,['--expose-internals',f.pnpm]);assert.equal(pm.command,f.executable)
 const env=desktopPnpmEnvironment(pm);assert.equal(env.ELECTRON_RUN_AS_NODE,'1');assert.equal(env.DSH_DESKTOP_NODE_EXECUTABLE,f.executable)
 assert.equal(env.DSH_DESKTOP_PNPM_RUNNER,undefined);assert.equal(env.DSH_DESKTOP_PNPM_ENTRY,undefined)
})
test('native Desktop installs with its CLI and verifies with plugin list instead of starting desktop',async t=>{
 const f=await fixture(t),entry=path.join(f.root,'official-cli.mjs'),record=path.join(f.root,'argv.jsonl')
 await writeFile(entry,`import fs from 'node:fs';const args=process.argv.slice(2);if(args.includes('--dump-config'))throw Error('reserved profile cannot start');fs.appendFileSync(${JSON.stringify(record)},JSON.stringify({args,home:process.env.DSH_HOME})+'\\n');`)
 const host={kind:'official-desktop',desktop:{layout:'bundled-cli',supported:true,resources:f.resources,cliEntry:entry},profileDir:f.root,profileName:'desktop',home:f.root,nodePath:process.execPath,dshRoot:'/must-not-run-generic-cli',runtimeEnv:{},capabilities:{writeSession:true},launch:{args:[]}}
 const archive=path.join(f.root,'space ; literal.tgz')
 await applyDshCli(host,{action:'install',packageName:'test-plugin',path:archive,storeDir:path.join(f.root,'logs')},{ownershipCheck:async()=>{}})
 const rows=(await readFile(record,'utf8')).trim().split('\n').map(JSON.parse)
 assert.deepEqual(rows.map(r=>r.args),[['plugin','--profile','desktop','add',archive,'--offline','--ignore-scripts'],['plugin','--profile','desktop','list']]);assert.ok(rows.every(r=>r.home===f.root))
})
test('native Desktop queues a running-app install and resumes after exit without writing early',async t=>{
 const {fixture:transaction}=await import('./manager-helpers.mjs'),{createOperationPlan}=await import('../core/plans.mjs'),{executePlan}=await import('../core/operations.mjs'),{officialDesktopAdapter}=await import('../adapters/official-desktop.mjs')
 const f=await transaction(t);f.host.kind='official-desktop';f.host.desktop={supported:true,layout:'bundled-cli',appPath:f.dir};f.host.capabilities={writeSession:true,requiresExit:true}
 const plan=await createOperationPlan({host:f.host,inspection:f.inspection,action:'install'})
 assert.equal(plan.requiresExit,true)
 const adapter=officialDesktopAdapter({runningProbe:async()=>true,ownershipCheck:async()=>{throw Error('must not write')}})
 const op=await executePlan(plan,{host:f.host,adapter,storeDir:path.join(f.dir,'state')})
 assert.equal(op.state,'waiting_for_host_exit');assert.equal(op.error,null)
})
test('process detection excludes another CLI using Desktop Electron but detects the main application',async()=>{
 const {desktopIsRunning}=await import('../adapters/official-desktop.mjs')
 const host={desktop:{layout:'bundled-cli',appPath:'/custom/Harness',executable:'/custom/Harness/DeepSeek Harness.exe'}}
 assert.equal(await desktopIsRunning(host,{processes:[{pid:1111,command:'"/custom/Harness/DeepSeek Harness.exe" --expose-internals /external/core.mjs menu'}]}),false)
 assert.equal(await desktopIsRunning(host,{processes:[{pid:1111,command:'"/custom/Harness/DeepSeek Harness.exe"'}]}),true)
})
test('manual Desktop path can be supplied as a quoted executable path',async t=>{
 const f=await fixture(t,process.platform==='darwin'?'darwin':'win32'),{createServices}=await import('../bootstrap/bootstrap.mjs')
 const services=await createServices({storeDir:path.join(f.root,'store'),discoveryOptions:{env:{PATH:''},userHome:f.root,processes:[]}})
 const found=await services.locate('"'+f.executable+'"')
 assert.ok(found.desktop.some(d=>d.appPath===f.app))
})
test('native Desktop batch preview reports its exit requirement',async t=>{
 const {fixture:transaction}=await import('./manager-helpers.mjs'),{createBatch}=await import('../core/batches.mjs')
 const f=await transaction(t);f.host.kind='official-desktop';f.host.desktop={layout:'bundled-cli'}
 const batch=await createBatch({host:f.host,inspections:[f.inspection],ownerId:'fixture',storeDir:path.join(f.dir,'state')})
 assert.equal(batch.requiresExit,true)
})
test('Windows registry discovery accepts product names with a release version suffix',async()=>{
 const {desktopRegistryPaths}=await import('../adapters/locate.mjs')
 assert.equal(typeof desktopRegistryPaths,'function')
 assert.deepEqual(desktopRegistryPaths([
  {DisplayName:'DeepSeek Harness 0.2.1-rc.2',InstallLocation:'D:\\Custom Apps\\Harness'},
  {DisplayName:'DeepSeek Harness',InstallLocation:'C:\\Apps\\Harness'},
  {DisplayName:'DSH Desktop 0.12.0',InstallLocation:'E:\\Tools\\DSH'},
  {DisplayName:'DeepSeek Harness Tools',InstallLocation:'D:\\Other'},
  {DisplayName:'Other',InstallLocation:'D:\\Other'},
  {DisplayName:'DeepSeek Harness',InstallLocation:'relative/path'}
 ]),['D:\\Custom Apps\\Harness','C:\\Apps\\Harness','E:\\Tools\\DSH'])
})
