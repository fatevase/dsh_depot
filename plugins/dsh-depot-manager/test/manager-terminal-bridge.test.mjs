import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import os from 'node:os'
import {mkdtemp,writeFile,rm} from 'node:fs/promises'
const bridge=await import('../bootstrap/terminal-bridge.mjs').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return{};throw e})
const mainUrl=new URL('../bootstrap/bootstrap.mjs',import.meta.url).href

test('a non-TTY child keeps the parent terminal menu and multiple prompts over IPC',async t=>{
 assert.equal(typeof bridge.runTerminalChild,'function')
 const root=await mkdtemp(path.join(os.tmpdir(),'depot-terminal-'));t.after(()=>rm(root,{recursive:true,force:true}))
 const entry=path.join(root,'child with spaces ; literal.mjs'),output=[],prompts=[],answers=['4','task-123']
 await writeFile(entry,`import {main} from ${JSON.stringify(mainUrl)};console.log('childTTY='+Boolean(process.stdin.isTTY));const host={hostId:'fixture',kind:'cli-web',profileName:'web',profileDir:${JSON.stringify(root)}};process.exitCode=await main(['menu'],{services:{hosts:async()=>[host],status:async({operation})=>({operation,state:'fixture-ready'})}});`)
 const code=await bridge.runTerminalChild(process.execPath,[entry],{io:{isTTY:true,write:s=>output.push(s),ask:async q=>{prompts.push(q);const a=answers.shift();assert.ok(a,'unexpected additional prompt');return a}},env:{...process.env}})
 assert.equal(code,0);assert.equal(prompts.length,2)
 const text=output.join('');assert.match(text,/childTTY=false/);assert.match(text,/1\. 安装 \/ 替换离线成品包/);assert.match(text,/5\. 恢复任务/);assert.match(text,/task-123/);assert.match(text,/fixture-ready/);assert.doesNotMatch(text,/INPUT_REQUIRED/)
})
test('terminal bridge does not turn a noninteractive parent into an interactive session',async()=>{
 assert.equal(typeof bridge.runTerminalChild,'function')
 await assert.rejects(bridge.runTerminalChild(process.execPath,[],{io:{isTTY:false}}),{code:'INPUT_REQUIRED'})
})
test('terminal bridge propagates a failed parent input without hanging the child',async t=>{
 assert.equal(typeof bridge.runTerminalChild,'function')
 const root=await mkdtemp(path.join(os.tmpdir(),'depot-terminal-failure-'));t.after(()=>rm(root,{recursive:true,force:true}))
 const entry=path.join(root,'child.mjs'),output=[]
 await writeFile(entry,`import {main} from ${JSON.stringify(mainUrl)};process.exitCode=await main(['menu'],{services:{hosts:async()=>[{hostId:'x',kind:'cli-web',profileName:'web',profileDir:${JSON.stringify(root)}}]}});`)
 const code=await bridge.runTerminalChild(process.execPath,[entry],{io:{isTTY:true,write:s=>output.push(s),ask:async()=>{throw Error('terminal input closed')}},env:{...process.env}})
 assert.equal(code,2);assert.match(output.join(''),/terminal input closed/)
})
test('an environment marker without IPC does not bypass the non-TTY check',async t=>{
 const {runHostCommand}=await import('../adapters/command.mjs')
 const root=await mkdtemp(path.join(os.tmpdir(),'depot-terminal-marker-'));t.after(()=>rm(root,{recursive:true,force:true}))
 const entry=path.join(root,'child.mjs');await writeFile(entry,`import {main} from ${JSON.stringify(mainUrl)};process.exitCode=await main(['menu'],{services:{}});`)
 const r=await runHostCommand({executable:process.execPath,args:[entry],cwd:root,envAllowlist:{DSH_DEPOT_TERMINAL:'not-an-ipc-channel'}})
 assert.equal(r.exitCode,2);assert.match(r.stdout,/INPUT_REQUIRED/)
})
test('parent abort cancels a pending child prompt',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'depot-terminal-abort-'));t.after(()=>rm(root,{recursive:true,force:true}))
 const entry=path.join(root,'child.mjs'),controller=new AbortController(),output=[]
 await writeFile(entry,`import {main} from ${JSON.stringify(mainUrl)};process.exitCode=await main(['menu'],{services:{hosts:async()=>[{hostId:'x',kind:'cli-web',profileName:'web',profileDir:${JSON.stringify(root)}}]}});`)
 const code=await bridge.runTerminalChild(process.execPath,[entry],{signal:controller.signal,io:{isTTY:true,write:s=>output.push(s),ask:async()=>{controller.abort();return new Promise(()=>{})}}})
 assert.equal(code,2);assert.match(output.join(''),/INPUT_CLOSED/)
})
test('real parent readline EOF ends the bridged menu instead of leaving IPC waiting',async t=>{
 const {spawn}=await import('node:child_process'),{once}=await import('node:events')
 const root=await mkdtemp(path.join(os.tmpdir(),'depot-terminal-eof-'));t.after(()=>rm(root,{recursive:true,force:true}))
 const leaf=path.join(root,'leaf.mjs'),parent=path.join(root,'parent.mjs'),bridgeUrl=new URL('../bootstrap/terminal-bridge.mjs',import.meta.url).href
 await writeFile(leaf,`import {main} from ${JSON.stringify(mainUrl)};process.exitCode=await main(['menu'],{services:{hosts:async()=>[{hostId:'x',kind:'cli-web',profileName:'web',profileDir:${JSON.stringify(root)}}]}});`)
 await writeFile(parent,`import {main} from ${JSON.stringify(mainUrl)};import {runTerminalChild} from ${JSON.stringify(bridgeUrl)};Object.defineProperty(process.stdin,'isTTY',{value:true});process.exitCode=await main(['menu'],{services:{discover:async()=>({hosts:[],desktop:[{supported:true,appPath:'/fixture'}]}),openDesktop:(_d,_args,terminal)=>runTerminalChild(process.execPath,[${JSON.stringify(leaf)}],terminal)}});`)
 const child=spawn(process.execPath,[parent],{stdio:['pipe','pipe','pipe'],env:{...process.env,DSH_DEPOT_TERMINAL:''}})
 let text='',ended=false,timedOut=false
 child.stdout.on('data',b=>{text+=b;if(!ended&&text.includes('请选择编号')){ended=true;child.stdin.end()}})
 child.stderr.on('data',b=>{text+=b})
 const timer=setTimeout(()=>{timedOut=true;child.kill('SIGKILL')},8000);t.after(()=>clearTimeout(timer))
 const [code]=await once(child,'close')
 assert.equal(ended,true,text);assert.equal(timedOut,false,'parent readline EOF left the child waiting');assert.equal(code,2,text)
})
