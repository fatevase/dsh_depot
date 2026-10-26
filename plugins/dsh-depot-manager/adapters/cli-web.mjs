import {offlinePolicyArgs} from './offline-policy.mjs'
import {applyDshCli} from './dsh-cli.mjs'
import {depotDataHome} from '../core/paths.mjs'
import {createRequire} from 'node:module'
import {pathToFileURL} from 'node:url'
import {readFile,mkdir,writeFile,rm,realpath} from 'node:fs/promises'
import {parse as parseYaml} from 'yaml'
import {assertOwnership} from './ownership.mjs'
import path from 'node:path'
import os from 'node:os'
import {fail} from '../contracts/constants.mjs'
import {json,hostFingerprint,hash} from './discover.mjs'
import {runHostCommand} from './command.mjs'
export function matchesHostCommand(command,host){
 const text=command.toLowerCase(),bin=path.join(host.dshRoot,'lib','bin.js').toLowerCase()
 if(text.includes('--dump-config'))return false
 return text.includes(bin)||/(?:^|[\s/\\])dsh(?:\.cmd|\.exe)?(?:["']?\s|$)/.test(text)||/(?:^|[\s/\\])lib[/\\]bin\.js(?:["']?\s|$)/.test(text)
}
export async function hostIsRunning(host){
 const live=await json(path.join(depotDataHome(),'manager','hosts',host.hostId,'host-live.json'),null)
 if(live?.hostId===host.hostId&&Number.isInteger(live.pid)){try{process.kill(live.pid,0);return true}catch(e){if(e.code!=='ESRCH')fail('HOST_EXIT_UNVERIFIED','无法核对宿主进程')}}
 const windows=process.platform==='win32'
 const command=windows?{executable:'powershell.exe',args:['-NoProfile','-NonInteractive','-Command',"$ErrorActionPreference='Stop'; $env:PSModulePath=[IO.Path]::Combine($PSHOME,'Modules'); Get-CimInstance Win32_Process | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress"]}:{executable:'ps',args:['-u',String(process.getuid()),'-o','pid=,args=']}
 const result=await runHostCommand({...command,cwd:host.profileDir},{timeoutMs:10000,maxBytes:8*1024*1024})
 if(result.exitCode||result.timedOut||result.stdout.length>=8*1024*1024)fail('HOST_EXIT_UNVERIFIED','无法完整检查目标宿主进程')
 const rows=windows?[].concat(JSON.parse(result.stdout||'[]')):result.stdout.split('\n').map(line=>{const m=line.trim().match(/^(\d+)\s+(.*)$/);return m?{ProcessId:+m[1],CommandLine:m[2]}:null}).filter(Boolean)
 const canonical=await realpath(path.join(host.dshRoot,'lib/bin.js'))
 for(const row of rows){
  const text=row.CommandLine??'';if(row.ProcessId===process.pid||!text)continue
  const knownPrefix=host.nodePath&&text.startsWith(host.nodePath+' ')?host.nodePath:null
  const executableMatch=text.match(/^(?:"([^"]+)"|(.+?[\\/]node(?:\.exe)?|node(?:\.exe)?))(?=\s|$)/i)
  const executable=knownPrefix??executableMatch?.[1]??executableMatch?.[2]
  if(!executable||(!/^node(?:\.exe)?$/i.test(path.basename(executable))&&executable!==host.nodePath))continue
  const rest=text.slice(knownPrefix?knownPrefix.length:executableMatch[0].length)
  const words=[executable,...(rest.match(/"[^"]*"|'[^']*'|\S+/g)??[]).map(x=>x.replace(/^["']|["']$/g,''))]
  const candidateMatch=matchesHostCommand(text,host)
  if(text.includes('--dump-config'))continue
  let cwd
  if(process.platform==='linux')cwd=await realpath('/proc/'+row.ProcessId+'/cwd').catch(()=>null)
  else if(process.platform==='darwin'){const r=await runHostCommand({executable:'/usr/sbin/lsof',args:['-a','-p',String(row.ProcessId),'-d','cwd','-Fn'],cwd:host.profileDir},{timeoutMs:5000});cwd=r.stdout.split('\n').find(x=>x.startsWith('n'))?.slice(1)}
  let resolvedScript=false
  for(let i=1;i<Math.min(words.length,32);i++){
   if(words[i].startsWith('-'))continue
   for(let end=i+1;end<=Math.min(words.length,i+8);end++){
    const candidate=words.slice(i,end).join(' ')
    if(!path.isAbsolute(candidate)&&!cwd)continue
    const resolved=await realpath(path.resolve(cwd??host.profileDir,candidate)).catch(()=>null)
    if(resolved===canonical)return true
    if(resolved&&(candidate.endsWith('.js')||candidate.endsWith('.mjs')||path.basename(candidate)==='dsh'))resolvedScript=true
   }
  }
  if(candidateMatch&&!resolvedScript){
   // A process may exit between the process snapshot and cwd/path inspection.
   try{process.kill(row.ProcessId,0)}catch(e){if(e.code==='ESRCH')continue}
   fail('HOST_EXIT_UNVERIFIED','无法确定正在运行的 DSH 入口所属安装，请检查进程后继续',{pid:row.ProcessId,cwd,script:words[1]})
  }
 }
 return false
}
const policyEnv=(env={},store)=>({...Object.fromEntries(Object.entries(env).filter(([key])=>!/^npm_config_(?:offline|ignore_scripts|auto_install_peers|manage_package_manager_versions|store_dir)$/i.test(key))),npm_config_offline:'true',npm_config_ignore_scripts:'true',npm_config_auto_install_peers:'false',npm_config_manage_package_manager_versions:'false',COREPACK_ENABLE_NETWORK:'0',...(store?{npm_config_store_dir:store}:{})})
export function cliWebAdapter({runningProbe=hostIsRunning,loadPublicServices,ownershipCheck=assertOwnership}={}){return {
 isRunning:runningProbe,
 applyDirect:(host,action,options)=>applyDshCli(host,action,{...options,runningProbe,ownershipCheck}),
 async launch(host){return host.launch},
 async withWriteSession(host,fn,{signal,quiesced=false}={}){
  if(!host.capabilities.writeSession)fail('HOST_CAPABILITY_UNVERIFIED','此 DSH 尚未验证安全写入能力')
  if(host.capabilities.requiresExit&&!quiesced)fail('HOST_EXIT_REQUIRED','请退出目标 DSH 后从脚本继续')
  if(host.capabilities.requiresExit&&await runningProbe(host))fail('HOST_STILL_RUNNING','检测到目标 DSH 仍在运行，请完全退出后继续')
  await ownershipCheck(host.profileDir)
  const req=loadPublicServices?null:createRequire(path.join(host.dshRoot,'package.json'))
  const loaded=loadPublicServices?await loadPublicServices():null
  const [atomic,operations]=loaded?[loaded.atomic,loaded.operations]:await Promise.all([import(pathToFileURL(req.resolve('@deepseek-ai/dsh-atomic-write'))),import(pathToFileURL(req.resolve('@deepseek-ai/dsh-plugin-manager/operations')))])
  return atomic.withFileLock(path.join(host.profileDir,'package.json'),async()=>{
   const idle=await operations.runProfilePnpm({profile:host.profileName,dir:host.profileDir,home:host.home,installAnchor:path.join(host.dshRoot,'package.json'),cwd:host.profileDir},['--version'],{...host.packageManager,execution:'service',outputBytes:4096,lockWaitMs:10000,lookupTimeoutMs:10000,env:{...host.packageManager?.env,npm_config_offline:'true',npm_config_ignore_scripts:'true',COREPACK_ENABLE_NETWORK:'0'}})
   if(idle.exitCode)fail('PACKAGE_SESSION_BUSY','存在未结束的包进程或不可用的包管理器，请先检查诊断')
   return fn({host,
   async readState(){return{manifest:await json(path.join(host.profileDir,'package.json')),fingerprint:await hostFingerprint(host)}},
   async readInventory(){const p=await json(path.join(host.profileDir,'package.json'));const rows=[];for(const [name,spec]of Object.entries(p.dependencies??{})){const pkg=await json(path.join(host.profileDir,'node_modules',name,'package.json'),{});if(pkg.dsh?.bundle?.patch)rows.push({name,spec,version:pkg.version,fingerprint:hash({name,spec,version:pkg.version})})}return rows},
   async apply(action){
    const flags=['--offline','--ignore-scripts','--config.auto-install-peers=false','--config.manage-package-manager-versions=false']
    const options={...host.packageManager,execution:'service',outputBytes:262144,lockWaitMs:10000,lookupTimeoutMs:10000,idleTimeoutMs:30000,signal,env:{...host.packageManager?.env,npm_config_offline:'true',npm_config_ignore_scripts:'true',npm_config_auto_install_peers:'false',npm_config_manage_package_manager_versions:'false',COREPACK_ENABLE_NETWORK:'0'}}
    const perform=async(dir,args,store)=>{
     const r=await operations.runProfilePnpm({profile:host.profileName,dir,home:host.home,installAnchor:path.join(host.dshRoot,'package.json'),cwd:dir},[...args,...offlinePolicyArgs()],{...options,args:[...(options.args??[]),'--config.offline=true','--config.ignore-scripts=true','--config.auto-install-peers=false','--config.manage-package-manager-versions=false',...(args.some(a=>a.startsWith('--config.store-dir='))?[]:['--config.store-dir='+(store??args[args.indexOf('--store-dir')+1])])],env:policyEnv(host.packageManager?.env,store??args[args.indexOf('--store-dir')+1])})
     if(r.exitCode!==0)fail('PACKAGE_OPERATION_FAILED','离线包操作失败',{exitCode:r.exitCode,output:r.output,logPath:r.logPath});return r
    }
    let installedStore
    try{installedStore=parseYaml(await readFile(path.join(host.profileDir,'node_modules/.modules.yaml'),'utf8'))?.storeDir}catch(e){if(e.code!=='ENOENT')throw e}
    if(action.action!=='remove'){
     const cold=path.join(action.storeDir,'cold-profile');await mkdir(cold,{recursive:true,mode:0o700})
     await writeFile(path.join(cold,'package.json'),JSON.stringify({name:'depot-cold-preflight',private:true,type:'module',dependencies:{},dsh:{profile:{bundles:[]}}}))
     await writeFile(path.join(cold,'pnpm-workspace.yaml'),'packages:\n  - .\nnodeLinker: hoisted\nautoInstallPeers: false\n')
     try{await perform(cold,['add',action.path,...flags,'--store-dir',path.join(action.storeDir,'empty')])}finally{await rm(cold,{recursive:true,force:true});await rm(path.join(action.storeDir,'empty'),{recursive:true,force:true})}
    }
    const store=installedStore??path.join(action.storeDir,'target-store')
    return perform(host.profileDir,action.action==='remove'?['remove',action.packageName,'--config.offline=true','--config.ignore-scripts=true','--config.auto-install-peers=false','--config.manage-package-manager-versions=false','--config.store-dir='+store]:['add',action.path,...flags,'--store-dir',store],store)
   },
   async compose(){const r=await runHostCommand({executable:host.nodePath,args:[...host.launch.args,'--dump-config'],cwd:host.profileDir,envAllowlist:{...host.runtimeEnv,DSH_HOME:host.home}},{signal});if(r.exitCode||/skipping profile bundle|failed to import/i.test(r.stderr))fail('COMPOSE_FAILED','DSH 配置合成失败',{output:r.stderr});return r.stdout}
  })},{waitMs:10000})
 }
}}
