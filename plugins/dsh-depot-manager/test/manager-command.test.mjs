import test from 'node:test'
import assert from 'node:assert/strict'
import {runHostCommand} from '../adapters/command.mjs'
test('timeout waits for actual child termination and escalates an ignored termination signal',{skip:process.platform==='win32'},async()=>{const started=performance.now();const r=await runHostCommand({executable:process.execPath,args:['-e',"process.on('SIGTERM',()=>{});setTimeout(()=>{},1500)"],cwd:process.cwd()},{timeoutMs:200});assert.equal(r.timedOut,true);assert.equal(r.exitCode,124)})
test('cooperative cancellation gives the service worker time to terminate its package child',{timeout:10000},async t=>{
 const fs=await import('node:fs/promises'),path=await import('node:path'),os=await import('node:os')
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'depot-cancel-')),marker=path.join(dir,'cleaned'),pidFile=path.join(dir,'pid');t.after(()=>fs.rm(dir,{recursive:true,force:true}))
 const script=`const {spawn}=require('node:child_process'),fs=require('node:fs');const c=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],{stdio:'ignore'});fs.writeFileSync(${JSON.stringify(pidFile)},String(c.pid));process.on('message',m=>{if(m.type!=='dsh-depot/cancel')return;setTimeout(()=>{c.once('exit',()=>{fs.writeFileSync(${JSON.stringify(marker)},'cleaned');process.disconnect()});c.kill('SIGKILL')},800)});process.stdout.write('ready');`
 const controller=new AbortController()
 try{await assert.rejects(runHostCommand({executable:process.execPath,args:['-e',script],cwd:dir},{signal:controller.signal,cooperativeCancel:true,terminationGraceMs:2000,onOutput:s=>{if(s.includes('ready'))controller.abort()}}),{code:'ABORT_ERR'});assert.equal(await fs.readFile(marker,'utf8'),'cleaned')}
 finally{try{process.kill(Number(await fs.readFile(pidFile,'utf8')),'SIGKILL')}catch{}}
})
