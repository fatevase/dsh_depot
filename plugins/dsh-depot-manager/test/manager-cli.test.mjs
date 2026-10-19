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
test('empty and invalid manual paths return to the menu instead of terminating the installer',async()=>{
 const messages=[],answers=['1','','1','relative/path','q'];let attempts=0
 const services={discover:async()=>({hosts:[],desktop:[]}),locate:async()=>{attempts++;throw Object.assign(Error('请输入完整路径'),{code:'INVALID_PATH'})}}
 const code=await cli.main(['menu'],{io:{isTTY:true,write:x=>messages.push(x),ask:async()=>answers.shift()},services})
 assert.equal(code,0);assert.equal(attempts,1);assert.match(messages.join(''),/路径为空/);assert.match(messages.join(''),/请输入完整路径/)
})
test('a discovered unsupported Desktop is shown as the actual reason instead of asking the user to keep searching',async()=>{
 const messages=[]
 const services={discover:async()=>({hosts:[],desktop:[{version:'0.12.0',appPath:'/Applications/DSH Desktop.app'}]}),locate:async()=>{}}
 assert.equal(await cli.main(['menu'],{io:{isTTY:true,write:x=>messages.push(x),ask:async()=> 'q'},services}),0)
 assert.match(messages.join(''),/已找到桌面应用，但当前安装器不能向它安装插件/)
})
test('a supported Desktop is selectable without asking the user for a CLI path',async()=>{
 const desktop={version:'0.12.0',supported:true,appPath:'/Applications/DSH Desktop.app'},messages=[];let opened
 const services={discover:async()=>({hosts:[],desktop:[desktop]}),openDesktop:async d=>{opened=d;return 0},locate:async()=>{throw Error('must not search again')}}
 const code=await cli.main(['menu'],{io:{isTTY:true,write:x=>messages.push(x),ask:async()=> '1'},services})
 assert.equal(code,0);assert.equal(opened,desktop);assert.match(messages.join(''),/使用应用自带 DSH/)
})
test('a Desktop host selected after handoff opens the action menu instead of relaunching',async()=>{
 const answers=['1','q'],messages=[]
 const host={hostId:'desktop-host',kind:'official-desktop',version:'0.2.0-rc.2',desktop:{version:'0.12.0'},profileName:'web',profileDir:'/data/profiles/web'}
 const code=await cli.main(['menu'],{services:{discover:async()=>({hosts:[host],desktop:[]})},io:{isTTY:true,write:x=>messages.push(x),ask:async()=>answers.shift()}})
 assert.equal(code,0);assert.match(messages.join(''),/安装 \/ 替换离线成品包/)
})
