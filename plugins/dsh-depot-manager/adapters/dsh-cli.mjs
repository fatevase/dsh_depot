import path from 'node:path'
import {readFile,mkdir,writeFile} from 'node:fs/promises'
import {runHostCommand} from './command.mjs'
import {assertOwnership} from './ownership.mjs'
import {fail} from '../contracts/constants.mjs'
// Invoke the installation's public CLI, including its own package-manager carrier.
// Arguments travel as JSON argv, never as shell source.
const entry=`import {pathToFileURL} from 'node:url';const input=JSON.parse(process.argv[1]);process.argv=[process.execPath,input.bin,...input.args];const {runCli}=await import(pathToFileURL(input.bin));await runCli(input.packageManager?{packageManager:input.packageManager}:undefined);`
export async function applyDshCli(host,action,{signal,onOutput,runningProbe,ownershipCheck=assertOwnership}={}){
 if(!host.capabilities?.writeSession||host.kind==='official-desktop'&&!host.desktop?.supported)fail('HOST_CAPABILITY_UNVERIFIED','此 DSH 尚未适配安装')
 if(host.desktop?.layout==='bundled-cli'&&runningProbe&&await runningProbe(host))fail('HOST_STILL_RUNNING','官方 Desktop 命令要求先完全退出应用；任务已保留，可退出后继续')
 await ownershipCheck(host.profileDir)
 const flags=action.action==='remove'?['--config.offline=true','--config.ignore-scripts=true']:['--offline','--ignore-scripts']
 const packageManager=host.packageManager
 onOutput?.(host.kind==='official-desktop'?'使用 DSH Desktop 自带的 pnpm 与安装包装。\n':'使用目标 DSH 的包管理入口。\n')
 const args=['plugin','--profile',host.profileName,action.action==='remove'?'remove':'add',action.action==='remove'?action.packageName:action.path,...flags]
 const env={...host.runtimeEnv,DSH_HOME:host.home,npm_config_offline:'true',npm_config_ignore_scripts:'true',COREPACK_ENABLE_NETWORK:'0'}
 const payload={bin:path.join(host.dshRoot,'lib/bin.js'),args,packageManager}
 const native=host.kind==='official-desktop'&&host.desktop.layout==='bundled-cli'
 const launchArgs=native?['--expose-internals',host.desktop.cliEntry,...args]:host.kind==='official-desktop'?['--expose-internals',path.join(host.desktop.resources,'harness-node-entry.mjs'),payload.bin,...args]:['--expose-internals','--input-type=module','-e',entry,JSON.stringify(payload)]
 const result=await runHostCommand({executable:host.nodePath,args:launchArgs,cwd:host.profileDir,envAllowlist:env},{signal,timeoutMs:300000,onOutput})
 await mkdir(action.storeDir,{recursive:true,mode:0o700});const logPath=path.join(action.storeDir,'dsh.log')
 await writeFile(logPath,result.stdout+'\n'+result.stderr,{mode:0o600})
 if(result.exitCode)fail('DSH_INSTALL_FAILED',`DSH 插件命令退出码 ${result.exitCode}；日志：${logPath}`,{exitCode:result.exitCode,logPath})
 const composed=await runHostCommand({executable:host.nodePath,args:native?['--expose-internals',host.desktop.cliEntry,'plugin','--profile',host.profileName,'list']:host.launch.args.concat('--dump-config'),cwd:host.profileDir,envAllowlist:env},{signal,timeoutMs:120000})
 if(composed.exitCode||/skipping profile bundle|failed to import/i.test(composed.stderr)){await writeFile(logPath,result.stdout+'\n'+result.stderr+'\n'+composed.stderr,{mode:0o600});fail('COMPOSE_FAILED',`DSH 安装后检查未通过；日志：${logPath}`)}
 return {logPath}
}
