import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import {desktopIsRunning,officialDesktopAdapter} from '../adapters/official-desktop.mjs'
test('Desktop process gate recognizes its main app and helpers but excludes the installer process',async()=>{
 const host={desktop:{appPath:'/Applications/DSH Desktop.app'}}
 for(const suffix of ['Contents/MacOS/DSH Desktop','Contents/Frameworks/DSH Desktop Helper.app/Contents/MacOS/DSH Desktop Helper']){
  assert.equal(await desktopIsRunning(host,{processes:[{pid:12345,command:host.desktop.appPath+'/'+suffix}]}),true)
 }
 assert.equal(await desktopIsRunning(host,{processes:[{pid:process.pid,command:host.desktop.appPath+'/Contents/MacOS/DSH Desktop'}]}),false)
 assert.equal(await desktopIsRunning(host,{processes:[{pid:12345,command:'/Applications/Other.app/Contents/MacOS/Other'}]}),false)
 assert.equal(await desktopIsRunning(host,{processes:[{pid:12345,command:'/Applications/Another DSH.app/Contents/MacOS/DSH Desktop --user-data-dir=/same/data'}]}),true)
})
test('an unsupported Desktop cannot acquire a write session',async()=>{
 let writes=0
 await assert.rejects(()=>officialDesktopAdapter().withWriteSession({desktop:{supported:false},capabilities:{writeSession:true}},()=>writes++),{code:'DESKTOP_CAPABILITY_UNVERIFIED'})
 assert.equal(writes,0)
})
test('Desktop runtime handoff passes the external archive as literal arguments',{skip:process.platform!=='darwin'},async t=>{
 const {mkdtemp,mkdir,writeFile,readFile,rm}=await import('node:fs/promises'),os=await import('node:os')
 const {openDesktopInstaller}=await import('../bootstrap/desktop.mjs')
 const root=await mkdtemp(path.join(os.tmpdir(),'depot-desktop-argv-'));t.after(()=>rm(root,{recursive:true,force:true}))
 const app=path.join(root,'DSH Desktop.app'),resources=path.join(app,'Contents/Resources/app'),exe=path.join(app,'Contents/MacOS/DSH Desktop'),record=path.join(root,'args.txt')
 await mkdir(resources,{recursive:true});await mkdir(path.dirname(exe),{recursive:true})
 await writeFile(path.join(resources,'package.json'),JSON.stringify({name:'dsh-desktop',version:'0.12.0',dependencies:{'@deepseek-ai/dsh':'0.2.0-rc.2'}}))
 await writeFile(exe,'#!/bin/sh\nprintf "%s\\n" "$@" > "$DSH_DEPOT_ARGV_RECORD"\n',{mode:0o755})
 const file=path.join(root,'plugin with spaces; literal.tgz')
 assert.equal(await openDesktopInstaller({appPath:app},{entry:'/test/core.mjs',args:['menu','--file',file],env:{DSH_DEPOT_ARGV_RECORD:record}}),0)
 assert.deepEqual((await readFile(record,'utf8')).trim().split('\n'),['/test/core.mjs','menu','--file',file])
})
