import {depotDataHome} from '../core/paths.mjs'
import path from 'node:path'
import {randomUUID} from 'node:crypto'
import {resumeBatch} from '../core/batches.mjs'
import semver from 'semver'
import {CORE_NODE_RANGE} from '../contracts/constants.mjs'
import os from 'node:os'
import {fileURLToPath,pathToFileURL} from 'node:url'
import {readFile,mkdir} from 'node:fs/promises'
import {createInterface} from 'node:readline/promises'
import {discoverHosts,probeHost} from '../adapters/discover.mjs'
import {cliWebAdapter} from '../adapters/cli-web.mjs'
import {inspectArtifact} from '../core/inspect.mjs'
import {createOperationPlan} from '../core/plans.mjs'
import {executePlan,recoverOperation,readOperation,inspectRecovery} from '../core/operations.mjs'
import {atomicJson,readJson} from '../core/files.mjs'
import {fail,MANAGER_NAME} from '../contracts/constants.mjs'
import {pruneRetention} from '../core/retention.mjs'
import {prepareToolkit} from './toolkit.mjs'
import {choose} from './menu.mjs'

function parse(argv) {
 const [command='menu',...rest]=argv,allowed=new Set(['host','file','plan','confirm','operation','accept-unverified','host-exited'])
 if(!['menu','inspect','install','update','remove','recover','status'].includes(command))fail('INVALID_ARGUMENT','未知命令')
 const args={command}
 for(let i=0;i<rest.length;i++){const key=rest[i].replace(/^--/,'');if(!rest[i].startsWith('--')||!allowed.has(key)||args[key]!==undefined)fail('INVALID_ARGUMENT','参数无效');if(['accept-unverified','host-exited'].includes(key))args[key]=true;else {if(!rest[i+1]||rest[i+1].startsWith('--'))fail('INVALID_ARGUMENT','缺少参数值');args[key]=rest[++i]}}
 return args
}
const baseDir=()=>path.join(depotDataHome(),'manager')
export async function createServices({storeDir=baseDir()}={}) {
 const hosts=()=>discoverHosts({onIssue:issue=>{if(issue.code!=='ENOENT')process.stderr.write(`${issue.code}: ${issue.message}\n`)}})
 async function selected(id){const host=(await hosts()).find(x=>x.hostId===id);if(!host)fail('HOST_NOT_FOUND','没有匹配的 DSH 环境');await pruneRetention({storeDir:path.join(storeDir,'hosts',host.hostId),profileDir:host.profileDir,hostId:host.hostId}).catch(()=>{});return host}
 const local=id=>path.join(storeDir,'hosts',id)
 return {
  hosts,
  async inspect(args){const host=await selected(args.host);const inspection=await inspectArtifact({path:args.file,host,workDir:path.join(local(host.hostId),'imports')});const plan=await createOperationPlan({host,inspection,action:'install',acceptUnverified:args['accept-unverified']});plan.ownerId=host.ownerId;await atomicJson(path.join(storeDir,'plans',plan.planId+'.json'),plan);return {planId:plan.planId,hostId:host.hostId,packageName:plan.packageName,version:plan.version,previousVersion:plan.previousVersion,action:plan.action,warnings:inspection.warnings,requiresExit:plan.requiresExit,expiresAt:plan.expiresAt}},
  async execute(args){const plan=await readJson(path.join(storeDir,'plans',safeId(args.plan)+'.json'));const host=await selected(plan.hostId);if(args.host&&args.host!==host.hostId)fail('HOST_CHANGED','环境与预览不符');const refreshed=await probeHost(host);return executePlan(plan,{host:refreshed,adapter:cliWebAdapter(),storeDir:local(host.hostId),quiesced:args['host-exited']===true,signal:args.signal})},
  async pending(id){const {operationsIn}=await import('../core/receipts.mjs');return (await operationsIn(local(id))).filter(o=>o.state==='waiting_for_host_exit').map(o=>({operationId:o.operationId,planId:o.planId,packageName:o.plan.packageName}))},
  async resume(args){const host=await selected(args.host),op=await readOperation(safeId(args.operation),{storeDir:local(host.hostId)});return op.batched?resumeBatch(op.operationId,{host,adapter:cliWebAdapter(),storeDir:local(host.hostId),quiesced:args['host-exited']===true,refreshHost:()=>probeHost(host),signal:args.signal}):executePlan(op.plan,{host:await probeHost(host),adapter:cliWebAdapter(),storeDir:local(host.hostId),quiesced:args['host-exited']===true,signal:args.signal})},
  async status(args){const found=[];for(const host of await hosts()){try{found.push(await readOperation(safeId(args.operation),{storeDir:local(host.hostId)}))}catch(e){if(e.code!=='ENOENT')throw e}}if(found.length!==1)fail('OPERATION_NOT_FOUND','未找到任务');return publicResult(found[0])},
  async previewRecovery(args){const host=await selected(args.host),preview=await inspectRecovery(safeId(args.operation),{host,storeDir:local(host.hostId)});preview.recoveryPlanId=randomUUID();preview.expiresAt=Date.now()+900000;await atomicJson(path.join(storeDir,'recovery-plans',preview.recoveryPlanId+'.json'),preview);return preview},
  async recover(args){const preview=await readJson(path.join(storeDir,'recovery-plans',safeId(args.plan)+'.json'));if(Date.now()>=preview.expiresAt)fail('PLAN_EXPIRED','恢复预览已过期');const host=await selected(preview.hostId);return recoverOperation(preview.operationId,{host,adapter:cliWebAdapter(),storeDir:local(host.hostId),expectedCurrentFingerprint:preview.currentFingerprint,quiesced:args['host-exited']===true,signal:args.signal})},
  async previewRemove(args){const host=await selected(args.host),name=args.file;if(!name)fail('INPUT_REQUIRED','请提供要移除的插件名');const p=await readJson(path.join(host.profileDir,'package.json'));const plan=await createOperationPlan({host,packageName:name,installedFingerprint:JSON.stringify(p.dependencies?.[name]),action:'remove'});await atomicJson(path.join(storeDir,'plans',plan.planId+'.json'),plan);return publicResult(plan)}
 }
}
const safeId=value=>{if(typeof value!=='string'||!/^[\w-]{1,100}$/.test(value))fail('INVALID_ID','编号无效');return value}
const publicResult=value=>{const {_inspection,plan,beforeState,snapshot,activationNonce,activationNonceDigest,...safe}=value;return safe}
export async function main(argv,{io,services}={}) {
 const controller=new AbortController(),stop=()=>controller.abort();process.once('SIGINT',stop);process.once('SIGTERM',stop)
 const rl=!io&&process.stdin.isTTY?createInterface({input:process.stdin,output:process.stdout}):null
 io??={isTTY:!!process.stdin.isTTY,write:s=>process.stdout.write(String(s)),ask:q=>rl.question(q,{signal:controller.signal})}
 try {
  if(!semver.satisfies(process.versions.node,CORE_NODE_RANGE))fail('RUNTIME_UNSUPPORTED',`需要 Node ${CORE_NODE_RANGE}`)
  const args=parse(argv);args.signal=controller.signal
  if(['install','update','remove'].includes(args.command)&&(!args.plan||args.confirm!==args.plan))fail('INPUT_REQUIRED','执行需要 --plan <编号> --confirm <同一编号>；先 inspect 生成预览')
  if(args.command==='recover'&&args.plan&&args.confirm!==args.plan)fail('INPUT_REQUIRED','恢复需要确认刚生成的恢复计划编号')
  if(!services){const root=fileURLToPath(new URL('.',import.meta.url));const bundle=await readJson(path.join(root,'bundle.json'),null);if(bundle){const toolkit=await prepareToolkit({root,storeDir:baseDir(),target:undefined});if(io.isTTY)io.write(`维护入口已保存：${toolkit.entryPath}\n`);}services=await createServices()}
  if(args.command==='menu'){
   const host=await choose(io,'选择要管理的本机 DSH 环境',(await services.hosts()).map(h=>({label:`${h.kind} ${h.version} / ${h.profileName} / ${h.profileDir}`,value:h})))
   if(!host)return 0
   const action=await choose(io,'操作',[{label:'安装 / 替换离线成品包',value:'install'},{label:'卸载插件（保留数据）',value:'remove'},{label:'继续待处理任务',value:'resume'},{label:'查看任务',value:'status'},{label:'恢复任务',value:'recover'}]);if(!action)return 0
   if(action==='resume'){const job=await choose(io,'待处理任务',(await services.pending(host.hostId)).map(o=>({label:`${o.packageName} / ${o.operationId}`,value:o})));if(!job)return 0;if(await io.ask('确认目标 DSH 已完全退出？输入 yes：')!=='yes')return 0;io.write(JSON.stringify(publicResult(await services.resume({host:host.hostId,operation:job.operationId,'host-exited':true,signal:controller.signal})),null,2)+'\n');return 0}
   if(action==='status'){io.write(JSON.stringify(await services.status({operation:await io.ask('任务编号：')}),null,2)+'\n');return 0}
   if(action==='recover'){const id=await io.ask('任务编号：'),preview=await services.previewRecovery({host:host.hostId,operation:id});io.write(JSON.stringify(preview,null,2)+'\n');if(await io.ask('检查以上当前状态并确认恢复，目标 DSH 已完全退出？输入 yes：')!=='yes')return 0;io.write(JSON.stringify(publicResult(await services.recover({plan:preview.recoveryPlanId,'host-exited':true,signal:controller.signal})),null,2)+'\n');return 0}
   const file=await io.ask(action==='remove'?'插件包名：':'离线 .tgz 或成品目录的完整路径（回车安装随包管理器）：') || fileURLToPath(new URL('./manager.tgz',import.meta.url))
   const input={host:host.hostId,file}
   if(action!=='remove')input['accept-unverified']=await io.ask('未验证的第三方包需要明确接受风险。允许尝试？输入 yes：')==='yes'
   const preview=await (action==='remove'?services.previewRemove(input):services.inspect(input));io.write(JSON.stringify(preview,null,2)+'\n')
   if(await io.ask('确认以上环境与变更？输入 yes：')!=='yes')return 0
   const exited=await io.ask('请退出目标 DSH，确认完全退出后输入 yes：')==='yes'
   io.write(JSON.stringify(publicResult(await services.execute({plan:preview.planId,confirm:preview.planId,'host-exited':exited,signal:controller.signal})),null,2)+'\n');return 0
  }
  const result=await (args.command==='inspect'?services.inspect(args):args.command==='status'?services.status(args):args.command==='recover'?(args.plan?services.recover(args):services.previewRecovery(args)):services.execute(args))
  io.write(JSON.stringify(publicResult(result),null,2)+'\n');return 0
 }catch(e){io.write(`${e.code??'MANAGER_FAILED'}: ${e.message}\n`);return 2}finally{rl?.close();process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop)}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)process.exitCode=await main(process.argv.slice(2))
