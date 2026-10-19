import test from 'node:test'
import assert from 'node:assert/strict'
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
