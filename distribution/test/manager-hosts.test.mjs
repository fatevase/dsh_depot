import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,symlink,rm,realpath} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
const api=await import('../manager/adapters/discover.mjs').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e})
async function setup(t){const dir=await realpath(await mkdtemp(path.join(os.tmpdir(),'depot-host-test-')));t.after(()=>rm(dir,{recursive:true,force:true}));const pkg=path.join(dir,'dsh');await mkdir(pkg);await writeFile(path.join(pkg,'package.json'),JSON.stringify({name:'@deepseek-ai/dsh',version:'0.2.0-rc.2'}));const home=path.join(dir,'custom-home'),profile=path.join(home,'profiles/web');await mkdir(profile,{recursive:true});await writeFile(path.join(profile,'package.json'),'{}');return{dir,pkg,home,profile}}
test('discovery canonicalizes duplicate profile paths and retains distinct homes',async t=>{
 assert.equal(typeof api.discoverHosts,'function','host discovery implemented');const s=await setup(t);await symlink(s.home,path.join(s.dir,'alias'),'dir');const second=path.join(s.dir,'second');await mkdir(path.join(second,'profiles/web'),{recursive:true});await writeFile(path.join(second,'profiles/web/package.json'),'{}');const candidates=[s.home,path.join(s.dir,'alias'),second].map(home=>({home,dshRoot:s.pkg,nodePath:process.execPath,profileName:'web'}));const hosts=await api.discoverHosts({locations:candidates,env:{DSH_HOME:s.home}});assert.equal(hosts.length,2);assert.ok(hosts.some(h=>h.profileDir===s.profile));assert.notEqual(hosts[0].hostId,hosts[1].hostId)
})
test('host fingerprint detects changed directory links and npm cannot manage desktop',async t=>{
 assert.equal(typeof api.probeHost,'function');const s=await setup(t);const c={home:s.home,dshRoot:s.pkg,nodePath:process.execPath,profileName:'web'};const first=await api.probeHost(c);assert.equal(first.runtime.source,'host');assert.equal(first.target,process.platform==='darwin'?'macos-arm64':`${process.platform}-${process.arch}`);await writeFile(path.join(s.profile,'package.json'),'{"dependencies":{"different":"1.0.0"}}');assert.notEqual((await api.probeHost(c)).fingerprint,first.fingerprint);await assert.rejects(()=>api.probeHost({...c,profileName:'desktop'}),{code:'DESKTOP_OWNER_REQUIRED'})
})
test('CLI adapter refuses write admission while the selected Host is still running',async()=>{
 const {cliWebAdapter}=await import('../manager/adapters/cli-web.mjs');let acquired=false;const adapter=cliWebAdapter({runningProbe:async()=>true});await assert.rejects(()=>adapter.withWriteSession({capabilities:{writeSession:true,requiresExit:true}},()=>{acquired=true},{quiesced:true}),{code:'HOST_STILL_RUNNING'});assert.equal(acquired,false)
})
test('process identity distinguishes a second DSH installation and resolves a literal alias',{skip:process.platform==='win32'},async t=>{
 const {spawn}=await import('node:child_process'),{once}=await import('node:events'),{symlink}=await import('node:fs/promises'),{hostIsRunning}=await import('../manager/adapters/cli-web.mjs');const dir=await mkdtemp(path.join(os.tmpdir(),'host-process-'));t.after(()=>rm(dir,{recursive:true,force:true}));const a=path.join(dir,'a'),b=path.join(dir,'b');for(const root of [a,b]){await mkdir(path.join(root,'lib'),{recursive:true});await writeFile(path.join(root,'lib/bin.js'),'console.log("ready");setInterval(()=>{},10000)')}
 const host={hostId:'test-process-host',profileDir:dir,dshRoot:a},other=spawn(process.execPath,['./lib/bin.js'],{cwd:b,stdio:['ignore','pipe','ignore']});t.after(()=>other.kill());await once(other.stdout,'data');assert.equal(await hostIsRunning(host),false);other.kill();await once(other,'exit');const alias=path.join(dir,'literal alias');await symlink(path.join(a,'lib/bin.js'),alias);const selected=spawn(process.execPath,[alias],{stdio:['ignore','pipe','ignore']});t.after(()=>selected.kill());await once(selected.stdout,'data');assert.equal(await hostIsRunning(host),true)
})
