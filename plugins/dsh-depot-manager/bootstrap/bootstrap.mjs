import {depotDataHome} from '../core/paths.mjs'
import path from 'node:path'
import {randomUUID} from 'node:crypto'
import {resumeBatch} from '../core/batches.mjs'
import semver from 'semver'
import {CORE_NODE_RANGE,MANAGER_VERSION} from '../contracts/constants.mjs'
import os from 'node:os'
import {fileURLToPath,pathToFileURL} from 'node:url'
import {readFile,mkdir,realpath} from 'node:fs/promises'
import {createInterface} from 'node:readline/promises'
import {discoverEnvironments,probeHost} from '../adapters/discover.mjs'
import {adapterFor} from '../adapters/select.mjs'
import {openDesktopInstaller} from './desktop.mjs'
import {inspectArtifact} from '../core/inspect.mjs'
import {createOperationPlan} from '../core/plans.mjs'
import {executePlan,recoverOperation,readOperation,inspectRecovery} from '../core/operations.mjs'
import {atomicJson,readJson} from '../core/files.mjs'
import {fail,MANAGER_NAME} from '../contracts/constants.mjs'
import {pruneRetention} from '../core/retention.mjs'
import {prepareToolkit} from './toolkit.mjs'
import {choose} from './menu.mjs'
import {readDiscoverySettings} from './settings.mjs'

function parse(argv) {
 const [command='menu',...rest]=argv,allowed=new Set(['host','file','plan','confirm','operation','accept-unverified','host-exited'])
 if(!['menu','diagnose','inspect','install','update','remove','recover','status'].includes(command))fail('INVALID_ARGUMENT','未知命令')
 const args={command}
 for(let i=0;i<rest.length;i++){const key=rest[i].replace(/^--/,'');if(!rest[i].startsWith('--')||!allowed.has(key)||args[key]!==undefined)fail('INVALID_ARGUMENT','参数无效');if(['accept-unverified','host-exited'].includes(key))args[key]=true;else {if(!rest[i+1]||rest[i+1].startsWith('--'))fail('INVALID_ARGUMENT','缺少参数值');args[key]=rest[++i]}}
 return args
}
const baseDir=()=>path.join(depotDataHome(),'manager')
export async function createServices({storeDir=baseDir(),discoveryOptions={}}={}) {
 const paths=[...(discoveryOptions.paths??[])]
 const discover=async()=>{
  const found=await discoverEnvironments({...discoveryOptions,paths})
  const home=(discoveryOptions.env??process.env).DSH_HOME
  if(home){const canonical=await realpath(home).catch(()=>null),matches=found.hosts.filter(h=>h.home===canonical);if(matches.length===1)found.preferredHostId=matches[0].hostId}
  return found
 }
 const hosts=async()=>(await discover()).hosts
 async function selected(id){const host=(await hosts()).find(x=>x.hostId===id);if(!host)fail('HOST_NOT_FOUND','没有匹配的 DSH 环境');await pruneRetention({storeDir:path.join(storeDir,'hosts',host.hostId),profileDir:host.profileDir,hostId:host.hostId}).catch(()=>{});return host}
 const local=id=>path.join(storeDir,'hosts',id)
 return {
  hosts,discover,
  async isRunning(id){const host=await selected(id);return adapterFor(host).isRunning(host)},
  openDesktop:process.versions.electron&&(discoveryOptions.env??process.env).DSH_DEPOT_DESKTOP_APP?undefined:(desktop,args)=>openDesktopInstaller(desktop,{entry:fileURLToPath(import.meta.url),args,env:{...(discoveryOptions.env??process.env),DSH_DEPOT_SEARCH_PATHS:JSON.stringify(paths)}}),
  async locate(input){let value=input.trim().replace(/^([\"\'])(.*)\1$/,'$2');if(value.startsWith('~/'))value=path.join(os.homedir(),value.slice(2));if(!path.isAbsolute(value))fail('INVALID_PATH','请输入应用、DSH 安装或配置目录的完整路径');paths.push(value);return discover()},
  async inspect(args){const host=await selected(args.host);const inspection=await inspectArtifact({path:args.file,host,workDir:path.join(local(host.hostId),'imports')});const plan=await createOperationPlan({host,inspection,action:'install',acceptUnverified:args['accept-unverified']});plan.ownerId=host.ownerId;await atomicJson(path.join(storeDir,'plans',plan.planId+'.json'),plan);return {planId:plan.planId,hostId:host.hostId,packageName:plan.packageName,version:plan.version,previousVersion:plan.previousVersion,action:plan.action,warnings:inspection.warnings,requiresExit:plan.requiresExit,expiresAt:plan.expiresAt}},
  async execute(args){const plan=await readJson(path.join(storeDir,'plans',safeId(args.plan)+'.json'));const host=await selected(plan.hostId);if(args.host&&args.host!==host.hostId)fail('HOST_CHANGED','环境与预览不符');const refreshed=await probeHost(host);return executePlan(plan,{host:refreshed,adapter:adapterFor(host),storeDir:local(host.hostId),quiesced:args['host-exited']===true,signal:args.signal,onEvent:args.onEvent,onOutput:args.onOutput})},
  async pending(id){const {operationsIn}=await import('../core/receipts.mjs');return (await operationsIn(local(id))).filter(o=>o.state==='waiting_for_host_exit').map(o=>({operationId:o.operationId,planId:o.planId,packageName:o.plan.packageName}))},
  async resume(args){const host=await selected(args.host),op=await readOperation(safeId(args.operation),{storeDir:local(host.hostId)});return op.batched?resumeBatch(op.operationId,{host,adapter:adapterFor(host),storeDir:local(host.hostId),quiesced:args['host-exited']===true,refreshHost:()=>probeHost(host),signal:args.signal}):executePlan(op.plan,{host:await probeHost(host),adapter:adapterFor(host),storeDir:local(host.hostId),quiesced:args['host-exited']===true,signal:args.signal,onEvent:args.onEvent,onOutput:args.onOutput})},
  async status(args){const found=[];for(const host of await hosts()){try{found.push(await readOperation(safeId(args.operation),{storeDir:local(host.hostId)}))}catch(e){if(e.code!=='ENOENT')throw e}}if(found.length!==1)fail('OPERATION_NOT_FOUND','未找到任务');return publicResult(found[0])},
  async previewRecovery(args){const host=await selected(args.host),preview=await inspectRecovery(safeId(args.operation),{host,storeDir:local(host.hostId)});preview.recoveryPlanId=randomUUID();preview.expiresAt=Date.now()+900000;await atomicJson(path.join(storeDir,'recovery-plans',preview.recoveryPlanId+'.json'),preview);return preview},
  async recover(args){const preview=await readJson(path.join(storeDir,'recovery-plans',safeId(args.plan)+'.json'));if(Date.now()>=preview.expiresAt)fail('PLAN_EXPIRED','恢复预览已过期');const host=await selected(preview.hostId);return recoverOperation(preview.operationId,{host,adapter:adapterFor(host),storeDir:local(host.hostId),expectedCurrentFingerprint:preview.currentFingerprint,quiesced:args['host-exited']===true,signal:args.signal})},
  async previewRemove(args){const host=await selected(args.host),name=args.file;if(!name)fail('INPUT_REQUIRED','请提供要移除的插件名');const p=await readJson(path.join(host.profileDir,'package.json'));const plan=await createOperationPlan({host,packageName:name,installedFingerprint:JSON.stringify(p.dependencies?.[name]),action:'remove'});await atomicJson(path.join(storeDir,'plans',plan.planId+'.json'),plan);return publicResult(plan)}
 }
}
const safeId=value=>{if(typeof value!=='string'||!/^[\w-]{1,100}$/.test(value))fail('INVALID_ID','编号无效');return value}
const publicResult=value=>{const {_inspection,plan,beforeState,snapshot,activationNonce,activationNonceDigest,...safe}=value;return safe}
function showPreview(io,host,preview){
 const action={install:'安装',replace:'替换',remove:'卸载'}[preview.action]??(preview.previousVersion?'替换':'安装')
 io.write(`\n目标：${host.kind==='official-desktop'?'DSH Desktop':'DSH CLI/Web'} / ${host.profileName}\n配置目录：${host.profileDir}\n操作：${action} ${preview.packageName}${preview.version?' '+preview.version:''}${preview.previousVersion?'（当前 '+preview.previousVersion+'）':''}\n`)
 for(const warning of preview.warnings??[])io.write(`提示：${warning.message??warning.code}\n`)
}
function showOutcome(io,value){
 const messages={waiting_for_host_exit:'检测到 DSH 仍在运行，任务已保存。完全退出 DSH 后，重新运行脚本并选择“继续待处理任务”。',awaiting_reload:'安装完成，请按原来的方式启动目标 DSH。宿主加载后才能确认插件已启用。',succeeded:value.result?.removed?'插件已卸载，配置与业务数据保留。':'操作完成。',failed_restored:'操作未完成，已恢复原状态。',recovery_required:'操作未完成，需要从“恢复任务”检查恢复点。',failed:'DSH 安装未完成。未自动回滚，请查看下方错误；修正后可重新安装成品包。'}
 io.write((messages[value.state]??`任务状态：${value.state}`)+'\n');if(value.error)io.write(`${value.error.code}: ${value.error.message}\n`);if(value.operationId)io.write(`任务编号：${value.operationId}\n`)
 return ['failed','recovery_required'].includes(value.state)?2:0
}
export async function main(argv,{io,services}={}) {
 const controller=new AbortController(),stop=()=>controller.abort();process.once('SIGINT',stop);process.once('SIGTERM',stop)
 const rl=!io&&process.stdin.isTTY?createInterface({input:process.stdin,output:process.stdout}):null
 io??={isTTY:!!process.stdin.isTTY,write:s=>process.stdout.write(String(s)),ask:q=>rl.question(q,{signal:controller.signal})}
 let phase='',phaseStarted=0
 const showPhase=label=>{phase=label;phaseStarted=Date.now();io.write(label+'\n')}
 const heartbeat=io.isTTY?setInterval(()=>{if(phase)io.write(`${phase}（已等待 ${Math.floor((Date.now()-phaseStarted)/1000)} 秒）\n`)},10000):null
 heartbeat?.unref()
 try {
  if(!semver.satisfies(process.versions.node,CORE_NODE_RANGE))fail('RUNTIME_UNSUPPORTED',`需要 Node ${CORE_NODE_RANGE}`)
  const args=parse(argv);args.signal=controller.signal
  const progress=event=>{const label={backing_up:'正在备份原插件和依赖…',applying:'正在调用 DSH 的包管理服务安装…',checking_install:'正在检查安装结果和 DSH 配置…',recovering:'正在恢复原配置…'}[event.state];if(label)showPhase(label)}
  let bannerShown=false
  const banner=()=>{if(io.isTTY&&!bannerShown){io.write(`DSH 离线插件管理器 ${MANAGER_VERSION}\n`);bannerShown=true}}
  if(['install','update','remove'].includes(args.command)&&(!args.plan||args.confirm!==args.plan))fail('INPUT_REQUIRED','执行需要 --plan <编号> --confirm <同一编号>；先 inspect 生成预览')
  if(args.command==='recover'&&args.plan&&args.confirm!==args.plan)fail('INPUT_REQUIRED','恢复需要确认刚生成的恢复计划编号')
  if(!services){const root=fileURLToPath(new URL('.',import.meta.url));const settings=await readDiscoverySettings(root);const bundle=await readJson(path.join(root,'bundle.json'),null);if(bundle){await prepareToolkit({root,storeDir:baseDir(),target:undefined,nodePath:bundle.flavor==='full'?path.join(root,'runtime',process.platform==='win32'?'node.exe':'node'):process.execPath});}services=await createServices({discoveryOptions:settings})}
  if(args.command==='diagnose'){io.write(JSON.stringify(await services.discover(),null,2)+'\n');return 0}
  if(args.command==='menu'){
   if(!io.isTTY)fail('INPUT_REQUIRED','无交互终端：请明确指定环境和已确认计划')
   let host
   while(!host){
    const found=services.discover?await services.discover():{hosts:await services.hosts(),desktop:[]}
    const preferred=found.hosts.find(h=>h.hostId===found.preferredHostId)
    const desktops=found.hosts.filter(h=>h.kind==='official-desktop')
    const apps=(found.desktop??[]).filter(d=>d.supported)
    if(preferred){host=preferred;break}
    if(desktops.length===1){host=desktops[0];break}
    if(!desktops.length&&apps.length===1&&services.openDesktop){io.write(`使用应用自带 DSH：${apps[0].appPath}\n`);rl?.close();return await services.openDesktop(apps[0],args.file?['menu','--file',args.file]:['menu'])}
    if(!desktops.length&&!apps.length&&found.hosts.length===1){host=found.hosts[0];break}
    banner()
    for(const d of found.desktop??[])io.write(`已找到 DSH Desktop ${d.version}：${d.appPath}\n${d.supported?'可选择下面的桌面入口，使用应用自带的 DSH 与运行时。':'已找到桌面应用，但当前安装器不能向它安装插件；继续搜索或手填同一路径不会解除此限制。'}\n`)
    for(const issue of found.issues??[])io.write(`${issue.code}: ${issue.message}\n`)
    if(!found.hosts.length&&!found.desktop?.length)io.write('未找到已初始化的 DSH 环境。可指定应用、DSH 安装目录或配置目录继续检查。\n')
    if(!found.hosts.length&&found.desktop?.length&&!services.openDesktop)io.write('未找到可操作的已初始化配置。请先启动过一次 DSH，或手动指定其配置主目录；仅填写应用路径不会创建配置。\n')
    const choices=found.hosts.map(h=>({label:`${h.kind==='official-desktop'?'DSH Desktop '+h.desktop.version:'DSH CLI/Web'} · DSH ${h.version} / ${h.profileName} / ${h.profileDir}`,value:h}))
    if(services.openDesktop&&!found.hosts.some(h=>h.kind==='official-desktop'))for(const d of found.desktop??[])if(d.supported)choices.push({label:`DSH Desktop ${d.version} / 使用应用自带 DSH`,value:{desktop:d}})
    if(services.locate)choices.push({label:'手动指定安装或配置路径 / 重新查找',value:'locate'})
    const selected=await choose(io,'选择要管理的本机 DSH 环境',choices)
    if(!selected)return 0
    if(selected==='locate'){
     const input=(await io.ask('完整路径（不要添加 shell 转义；q 返回）：')).trim();if(input==='q')continue
     if(!input){io.write('路径为空，已返回选择菜单。\n');continue}
     try{await services.locate(input)}catch(e){if(!['INVALID_PATH','ENOENT','ENOTDIR','EACCES'].includes(e.code))throw e;io.write(`${e.code}: ${e.message}；请重新输入或退出。\n`)}continue
    }
    if(selected.desktop&&!selected.hostId){rl?.close();return await services.openDesktop(selected.desktop,args.file?['menu','--file',args.file]:['menu'])}
    host=selected
   }
   banner()
   io.write(`目标：${host.kind==='official-desktop'?'DSH Desktop':'DSH CLI/Web'} / ${host.profileName}\n配置目录：${host.profileDir}\n`)
   const action=await choose(io,'操作',[{label:'安装 / 替换离线成品包',value:'install'},{label:'卸载插件（保留数据）',value:'remove'},{label:'继续待处理任务',value:'resume'},{label:'查看任务',value:'status'},{label:'恢复任务',value:'recover'}]);if(!action)return 0
   if(action==='resume'){const pending=await services.pending(host.hostId);if(!pending.length){io.write('没有待处理任务。\n');return 0}const job=pending.length===1?pending[0]:await choose(io,'待处理任务',pending.map(o=>({label:`${o.packageName} / ${o.operationId}`,value:o})));if(!job)return 0;if(await services.isRunning(host.hostId)){io.write('DSH 仍在运行，请完全退出 DSH 后再继续；任务已保留。\n');return 0}return showOutcome(io,await services.resume({host:host.hostId,operation:job.operationId,'host-exited':true,signal:controller.signal,onEvent:progress,onOutput:text=>io.write(text)}))}
   if(action==='status'){io.write(JSON.stringify(await services.status({operation:await io.ask('任务编号：')}),null,2)+'\n');return 0}
   if(action==='recover'){const id=await io.ask('任务编号：'),preview=await services.previewRecovery({host:host.hostId,operation:id});io.write(JSON.stringify(preview,null,2)+'\n');if(preview.execution==='dsh-cli'&&!['applying','checking_install'].includes(preview.state))return 0;if(await services.isRunning(host.hostId)){io.write('DSH 仍在运行，请完全退出 DSH 后重新检查恢复点。\n');return 0}return showOutcome(io,await services.recover({plan:preview.recoveryPlanId,'host-exited':true,signal:controller.signal}))}
   const file=args.file||(action==='remove'?await io.ask('插件包名：'):fileURLToPath(new URL('./manager.tgz',import.meta.url)))
   const input={host:host.hostId,file}
   // Selecting the action authorizes the operation; retain inspection and show warnings.
   if(action!=='remove')input['accept-unverified']=true
   showPhase('正在检查离线包和目标配置…')
   const preview=await (action==='remove'?services.previewRemove(input):services.inspect(input));showPreview(io,host,preview)
   const exited=preview.requiresExit===false||!await services.isRunning(host.hostId)
   return showOutcome(io,await services.execute({plan:preview.planId,confirm:preview.planId,'host-exited':exited,signal:controller.signal,onEvent:progress,onOutput:text=>io.write(text)}))
  }
  const result=await (args.command==='inspect'?services.inspect(args):args.command==='status'?services.status(args):args.command==='recover'?(args.plan?services.recover(args):services.previewRecovery(args)):services.execute(args))
  io.write(JSON.stringify(publicResult(result),null,2)+'\n');return 0
 }catch(e){io.write(`${e.code??'MANAGER_FAILED'}: ${e.message}\n`);return 2}finally{clearInterval(heartbeat);rl?.close();process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop)}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)process.exitCode=await main(process.argv.slice(2))
