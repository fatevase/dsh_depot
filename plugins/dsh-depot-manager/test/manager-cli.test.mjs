import test from 'node:test'
import assert from 'node:assert/strict'
const cli=await import('../bootstrap/bootstrap.mjs').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return{};throw e})
const runtime=await import('../bootstrap/runtime.mjs').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return{};throw e})
test('noninteractive writes require an explicit confirmed plan and never choose an environment',async()=>{
 assert.equal(typeof cli.main,'function');let writes=0;const messages=[];const code=await cli.main(['install'],{io:{isTTY:false,write:x=>messages.push(x)},services:{execute:()=>writes++}});assert.equal(code,2);assert.match(messages.join(''),/INPUT_REQUIRED/);assert.equal(writes,0)
})
test('runtime is independent of host and missing lite runtime fails without downloads',async()=>{
 assert.equal(typeof runtime.resolveRuntime,'function');await assert.rejects(()=>runtime.resolveRuntime({bundle:{flavor:'lite',root:'/tmp'},env:{PATH:''}}),{code:'RUNTIME_MISSING'});const toolkit=await runtime.resolveRuntime({bundle:{flavor:'lite',root:process.cwd()},nodePath:process.execPath});assert.equal(toolkit.nodePath,process.execPath);assert.equal(toolkit.flavor,'lite')
})
test('status in an SSH environment only prints durable state',async()=>{
 const messages=[];const code=await cli.main(['status','--operation','sample'],{io:{isTTY:false,write:x=>messages.push(x)},services:{status:async()=>({state:'awaiting_reload',result:{loaded:false}})}});assert.equal(code,0);assert.match(messages.join(''),/awaiting_reload/);assert.doesNotMatch(messages.join(''),/succeeded/)
})
test('interactive startup identifies the package version while diagnose remains JSON',async()=>{
 const {MANAGER_VERSION}=await import('../contracts/constants.mjs'),messages=[]
 const services={discover:async()=>({hosts:[],desktop:[]}),locate:async()=>{}}
 assert.equal(await cli.main(['menu'],{io:{isTTY:true,write:x=>messages.push(x),ask:async()=> 'q'},services}),0)
 assert.ok(messages.join('').includes(`DSH 离线插件管理器 ${MANAGER_VERSION}`))
 messages.length=0
 assert.equal(await cli.main(['diagnose'],{io:{isTTY:false,write:x=>messages.push(x)},services}),0)
 assert.deepEqual(JSON.parse(messages.join('')),{hosts:[],desktop:[]})
})
