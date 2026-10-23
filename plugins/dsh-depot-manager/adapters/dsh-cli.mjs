import path from 'node:path'
import {createRequire} from 'node:module'
import {pathToFileURL} from 'node:url'
import {readFile,mkdir,writeFile} from 'node:fs/promises'
import {runHostCommand} from './command.mjs'
import {assertOwnership} from './ownership.mjs'
import {offlineLockfileArgs} from './offline-policy.mjs'
import {fail} from '../contracts/constants.mjs'
// Invoke the installation's public CLI, including its own package-manager carrier.
// Arguments travel as JSON argv, never as shell source.
const entry=`import {pathToFileURL} from 'node:url';const input=JSON.parse(process.argv[1]);process.argv=[process.execPath,input.bin,...input.args];const {runCli}=await import(pathToFileURL(input.bin));await runCli(input.packageManager?{packageManager:input.packageManager}:undefined);`
export async function applyDshCli(host,action,{signal,onOutput,runningProbe,ownershipCheck=assertOwnership}={}){
 if(!host.capabilities?.writeSession||host.kind==='official-desktop'&&!host.desktop?.supported)fail('HOST_CAPABILITY_UNVERIFIED','此 DSH 尚未适配安装')
 if(host.desktop?.layout==='bundled-cli'&&runningProbe&&await runningProbe(host))fail('HOST_STILL_RUNNING','官方 Desktop 命令要求先完全退出应用；任务已保留，可退出后继续')
 await ownershipCheck(host.profileDir)
 const useLockedService=(await offlineLockfileArgs(host.profileDir)).length>0
 const flags=action.action==='remove'?['--config.offline=true','--config.ignore-scripts=true']:['--offline','--ignore-scripts']
 const packageManager=host.packageManager
 onOutput?.(host.kind==='official-desktop'?'使用 DSH Desktop 自带的 pnpm 与安装包装。\n':'使用目标 DSH 的包管理入口。\n')
 const args=['plugin','--profile',host.profileName,action.action==='remove'?'remove':'add',action.action==='remove'?action.packageName:action.path,...flags]
 const env={...host.runtimeEnv,DSH_HOME:host.home,npm_config_offline:'true',npm_config_ignore_scripts:'true',COREPACK_ENABLE_NETWORK:'0'}
 const payload={bin:path.join(host.dshRoot,'lib/bin.js'),args,packageManager}
 const native=host.kind==='official-desktop'&&host.desktop.layout==='bundled-cli'
 const launchArgs=native?['--expose-internals',host.desktop.cliEntry,...args]:host.kind==='official-desktop'?['--expose-internals',path.join(host.desktop.resources,'harness-node-entry.mjs'),payload.bin,...args]:['--expose-internals','--input-type=module','-e',entry,JSON.stringify(payload)]
 const command=useLockedService?{executable:host.nodePath,args:['--expose-internals','--input-type=module','-e',lockedEntry,JSON.stringify({workerUrl:import.meta.url,profile:host.profileName,dir:host.profileDir,home:host.home,installAnchor:path.join(host.dshRoot,'package.json'),args:args.slice(3),packageManager,env})],cwd:host.profileDir,envAllowlist:env}:{executable:host.nodePath,args:launchArgs,cwd:host.profileDir,envAllowlist:env}
 const result=await runHostCommand(command,{signal,timeoutMs:300000,onOutput,...(useLockedService?{cooperativeCancel:true,terminationGraceMs:6500}:{})})
 await mkdir(action.storeDir,{recursive:true,mode:0o700});const logPath=path.join(action.storeDir,'dsh.log')
 await writeFile(logPath,result.stdout+'\n'+result.stderr,{mode:0o600})
 if(result.exitCode)fail('DSH_INSTALL_FAILED',`DSH 插件命令退出码 ${result.exitCode}；日志：${logPath}`,{exitCode:result.exitCode,logPath})
 const composed=await runHostCommand({executable:host.nodePath,args:native?['--expose-internals',host.desktop.cliEntry,'plugin','--profile',host.profileName,'list']:host.launch.args.concat('--dump-config'),cwd:host.profileDir,envAllowlist:env},{signal,timeoutMs:120000})
 if(composed.exitCode||/skipping profile bundle|failed to import/i.test(composed.stderr)){await writeFile(logPath,result.stdout+'\n'+result.stderr+'\n'+composed.stderr,{mode:0o600});fail('COMPOSE_FAILED',`DSH 安装后检查未通过；日志：${logPath}`)}
 return {logPath}
}

const lockedEntry=`try{const input=JSON.parse(process.argv[1]);const {runOfflinePackageCommand}=await import(input.workerUrl);const result=await runOfflinePackageCommand(input);process.exitCode=result.timedOut?124:(result.exitCode??1)}finally{if(process.connected)process.disconnect()}`
// A one-shot child in the host runtime. This is the same public DSH operation
// used by its CLI, checked only after the official profile write lock is held.
export async function runOfflinePackageCommand(input,{loadPublicServices}={}){
 const controller=new AbortController(),stop=()=>controller.abort(),message=m=>{if(m?.type==='dsh-depot/cancel')stop()}
 process.once('SIGTERM',stop);process.once('SIGINT',stop);process.once('disconnect',stop);process.on('message',message)
 process.send?.({type:'dsh-depot/ready'})
 try{const req=createRequire(input.installAnchor)
 const {atomic,operations}=loadPublicServices?await loadPublicServices():{atomic:await import(pathToFileURL(req.resolve('@deepseek-ai/dsh-atomic-write'))),operations:await import(pathToFileURL(req.resolve('@deepseek-ai/dsh-plugin-manager/operations')))}
 if(controller.signal.aborted)fail('ABORT_ERR','安装已取消')
 return await atomic.withFileLock(path.join(input.dir,'package.json'),async()=>{
  const flags=await offlineLockfileArgs(input.dir)
  if(flags.length)process.stdout.write('本次离线操作信任与已安装记录一致的旧锁文件，不复审其仓库元数据；保留包完整性校验。\n')
  return operations.runProfilePnpm({...input,cwd:input.dir},[...input.args,...flags],{...input.packageManager,execution:'service',activateNewBundles:true,signal:controller.signal,outputBytes:262144,lockWaitMs:10000,lookupTimeoutMs:10000,idleTimeoutMs:30000,env:{...input.env,...input.packageManager?.env,npm_config_offline:'true',npm_config_ignore_scripts:'true',COREPACK_ENABLE_NETWORK:'0'},onOutput:(text,stream)=>process[stream].write(text)})
 },{waitMs:10000})}finally{process.removeListener('SIGTERM',stop);process.removeListener('SIGINT',stop);process.removeListener('disconnect',stop);process.removeListener('message',message)}
}
