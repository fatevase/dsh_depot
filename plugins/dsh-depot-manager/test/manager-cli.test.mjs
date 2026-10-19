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
test('a single Desktop host after handoff enters the action menu without a target question',async()=>{
 const answers=['q'],messages=[],prompts=[]
 const host={hostId:'desktop-host',kind:'official-desktop',version:'0.2.0-rc.2',desktop:{version:'0.12.0'},profileName:'web',profileDir:'/data/profiles/web'}
 const code=await cli.main(['menu'],{services:{discover:async()=>({hosts:[host],desktop:[]})},io:{isTTY:true,write:x=>messages.push(x),ask:async p=>{prompts.push(p);return answers.shift()}}})
 assert.equal(code,0);assert.equal(prompts.length,1);assert.match(messages.join(''),/安装 \/ 替换离线成品包/)
})
function menuFixture({running=false}={}){
 const host={hostId:'h',kind:'cli-web',version:'0.2.0-rc.2',profileName:'web',profileDir:'/data/profiles/web'},messages=[],prompts=[],calls=[]
 const answers=['1'],services={
  discover:async()=>({hosts:[host],desktop:[]}),
  inspect:async input=>{calls.push({method:'inspect',input});return{planId:'p',packageName:'dsh-depot-manager',version:'0.1.4',previousVersion:null,requiresExit:false,warnings:[{code:'UNVERIFIED_PACKAGE',message:'此包没有完整验收记录'}]}},
  isRunning:async()=>running,
  execute:async input=>{calls.push({method:'execute',input});return{operationId:'o',state:input['host-exited']?'awaiting_reload':'waiting_for_host_exit',result:{installed:input['host-exited']}}}
 }
 return{host,services,calls,messages,prompts,io:{isTTY:true,write:x=>messages.push(x),ask:async prompt=>{prompts.push(prompt);if(!answers.length)throw Error('Unexpected extra confirmation: '+prompt);return answers.shift()}}}
}
test('choosing installation performs the bundled install without further confirmations',async()=>{
 const f=menuFixture();assert.equal(await cli.main(['menu'],f),0)
 assert.equal(f.prompts.length,1);assert.ok(f.prompts.every(p=>!p.includes('yes')))
 assert.match(f.messages.join(''),/此包没有完整验收记录/);assert.match(f.messages.join(''),/\/data\/profiles\/web/)
 const execute=f.calls.find(c=>c.method==='execute');assert.equal(execute.input.confirm,'p');assert.equal(execute.input['host-exited'],true)
})
test('exiting the action menu never executes or probes the host',async()=>{
 const f=menuFixture();f.io.ask=async()=> 'q';f.services.isRunning=async()=>{throw Error('Should not probe after cancel')}
 assert.equal(await cli.main(['menu'],f),0);assert.ok(!f.calls.some(c=>c.method==='execute'))
})
test('a discovered supported Desktop is used automatically before the main menu',async()=>{
 const desktop={version:'0.12.0',supported:true,appPath:'/Applications/DSH Desktop.app'};let opened=false
 const services={discover:async()=>({hosts:[],desktop:[desktop]}),openDesktop:async d=>{assert.equal(d,desktop);opened=true;return 0}}
 const code=await cli.main(['menu'],{services,io:{isTTY:true,write:()=>{},ask:async()=>{throw Error('No target confirmation expected')}}})
 assert.equal(code,0);assert.equal(opened,true)
})
test('a running host installs immediately and only asks for a restart afterward',async()=>{
 const f=menuFixture({running:true});assert.equal(await cli.main(['menu'],f),0)
 assert.equal(f.calls.find(c=>c.method==='execute').input['host-exited'],true)
 assert.match(f.messages.join(''),/重启 DSH/)
})
test('an explicit target stays selected when several environments are discovered',async()=>{
 const f=menuFixture(),other={...f.host,hostId:'other',profileDir:'/other/profiles/web'}
 f.services.discover=async()=>({hosts:[other,f.host],desktop:[],preferredHostId:f.host.hostId})
 assert.equal(await cli.main(['menu','--file','/offline/custom package.tgz'],f),0)
 assert.equal(f.calls.find(c=>c.method==='inspect').input.file,'/offline/custom package.tgz')
 assert.equal(f.calls.find(c=>c.method==='inspect').input.host,'h');assert.equal(f.prompts.length,1)
})
test('ambiguous environments require choosing a target before showing actions',async()=>{
 const f=menuFixture(),answers=['2','q'];f.services.discover=async()=>({hosts:[f.host,{...f.host,hostId:'other'}],desktop:[]})
 f.io.ask=async p=>{f.prompts.push(p);return answers.shift()}
 assert.equal(await cli.main(['menu'],f),0);assert.equal(f.prompts.length,2);assert.equal(f.calls.length,0)
})
test('a single pending task resumes without another task or exit confirmation',async()=>{
 const f=menuFixture(),answers=['3'];f.io.ask=async p=>{f.prompts.push(p);if(!answers.length)throw Error('Unexpected extra prompt');return answers.shift()}
 f.services.pending=async()=>[{operationId:'queued',packageName:'dsh-depot-manager'}]
 f.services.resume=async input=>{f.calls.push({method:'resume',input});return{state:'awaiting_reload'}}
 assert.equal(await cli.main(['menu'],f),0);assert.equal(f.prompts.length,1);assert.equal(f.calls[0].input.operation,'queued')
})
test('recovery needs only the action and task ID, without a yes prompt',async()=>{
 const f=menuFixture(),answers=['5','previous'];f.io.ask=async p=>{f.prompts.push(p);if(!answers.length)throw Error('Unexpected extra prompt');return answers.shift()}
 f.services.previewRecovery=async()=>({recoveryPlanId:'recovery'})
 f.services.recover=async input=>{f.calls.push({method:'recover',input});return{state:'failed_restored'}}
 assert.equal(await cli.main(['menu'],f),0);assert.equal(f.prompts.length,2);assert.equal(f.calls[0].input.plan,'recovery')
})
test('Desktop handoff preserves the explicitly supplied offline package',async()=>{
 const desktop={supported:true,appPath:'/Applications/DSH Desktop.app'},file='/packages/offline plugin.tgz';let forwarded
 const services={discover:async()=>({hosts:[],desktop:[desktop]}),openDesktop:async(d,args)=>{forwarded=args;return 0}}
 assert.equal(await cli.main(['menu','--file',file],{services,io:{isTTY:true,write:()=>{},ask:async()=>{throw Error('Unexpected prompt')}}}),0)
 assert.deepEqual(forwarded,['menu','--file',file])
})
test('a failed DSH install exits with failure and explains that no rollback happened',async()=>{
 const f=menuFixture();f.services.execute=async()=>({state:'failed',error:{code:'DSH_INSTALL_FAILED',message:'check dsh.log'}})
 assert.equal(await cli.main(['menu'],f),2);assert.match(f.messages.join(''),/未自动回滚/);assert.match(f.messages.join(''),/dsh.log/)
})
