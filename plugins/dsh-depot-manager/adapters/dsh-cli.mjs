import path from 'node:path'
import {readFile,mkdir,writeFile} from 'node:fs/promises'
import {resolveProfilePnpm} from './profile-pnpm.mjs'
import {registeredToolkit} from '../bootstrap/toolkit.mjs'
import {depotDataHome} from '../core/paths.mjs'
import {runHostCommand} from './command.mjs'
import {assertOwnership} from './ownership.mjs'
import {fail} from '../contracts/constants.mjs'
// Invoke the installation's public CLI, including its own package-manager carrier.
// Arguments travel as JSON argv, never as shell source.
const entry=`import {pathToFileURL} from 'node:url';const input=JSON.parse(process.argv[1]);process.argv=[process.execPath,input.bin,...input.args];const {runCli}=await import(pathToFileURL(input.bin));await runCli({packageManager:input.packageManager});`
export async function applyDshCli(host,action,{signal,onOutput,runningProbe,ownershipCheck=assertOwnership}={}){
 if(!host.capabilities?.writeSession||host.kind==='official-desktop'&&!host.desktop?.supported)fail('HOST_CAPABILITY_UNVERIFIED','此 DSH 尚未适配安装')
 await ownershipCheck(host.profileDir)
 const flags=[...(action.action==='remove'?['--config.offline=true','--config.ignore-scripts=true']:['--offline','--ignore-scripts']),'--config.auto-install-peers=false','--config.manage-package-manager-versions=false']
 const packageManager=await resolveProfilePnpm(host,{toolkit:await registeredToolkit(path.join(depotDataHome(),'manager')),workDir:action.storeDir})
 if(packageManager.storeDir)flags.push('--store-dir',packageManager.storeDir)
 if(packageManager.version)onOutput?.(`使用兼容工具 pnpm ${packageManager.version}，保留现有 store。\n`)
 const args=['plugin','--profile',host.profileName,action.action==='remove'?'remove':'add',action.action==='remove'?action.packageName:action.path,...flags]
 const env={...host.runtimeEnv,DSH_HOME:host.home,npm_config_offline:'true',npm_config_ignore_scripts:'true',npm_config_auto_install_peers:'false',npm_config_manage_package_manager_versions:'false',COREPACK_ENABLE_NETWORK:'0'}
 const payload={bin:path.join(host.dshRoot,'lib/bin.js'),args,packageManager:{...packageManager,env:{...packageManager.env,...env}}}
 const result=await runHostCommand({executable:host.nodePath,args:['--expose-internals','--input-type=module','-e',entry,JSON.stringify(payload)],cwd:host.profileDir,envAllowlist:env},{signal,timeoutMs:300000,onOutput})
 await mkdir(action.storeDir,{recursive:true,mode:0o700});const logPath=path.join(action.storeDir,'dsh.log')
 await writeFile(logPath,result.stdout+'\n'+result.stderr,{mode:0o600})
 if(result.exitCode)fail('DSH_INSTALL_FAILED',`DSH 插件命令退出码 ${result.exitCode}；日志：${logPath}`,{exitCode:result.exitCode,logPath})
 const composed=await runHostCommand({executable:host.nodePath,args:host.launch.args.concat('--dump-config'),cwd:host.profileDir,envAllowlist:env},{signal,timeoutMs:120000})
 if(composed.exitCode||/skipping profile bundle|failed to import/i.test(composed.stderr)){await writeFile(logPath,result.stdout+'\n'+result.stderr+'\n'+composed.stderr,{mode:0o600});fail('COMPOSE_FAILED',`DSH 配置检查未通过；日志：${logPath}`)}
 return {logPath}
}
