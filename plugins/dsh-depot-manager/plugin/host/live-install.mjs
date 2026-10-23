import path from 'node:path'
import {createRequire} from 'node:module'
import {pathToFileURL} from 'node:url'
import {mkdir,writeFile,readFile} from 'node:fs/promises'
import {parse as parseYaml} from 'yaml'
import {offlineLockfileArgs} from '../../adapters/offline-policy.mjs'
import {fail} from '../../contracts/constants.mjs'
// Inside DSH, use its package operation service and live layer controls. The
// external bootstrap keeps its CLI adapter for environments without a running host.
export function liveInstallAdapter({profile,pluginManager,fallback,loadOperations,loadAtomic}){
 return{...fallback,liveInstall:true,async applyDirect(host,action,{signal,onOutput}={}){
  if(action.action==='remove')return fallback.applyDirect(host,action,{signal,onOutput})
  if(signal?.aborted)fail('ABORT_ERR','安装已取消')
  const operations=loadOperations?await loadOperations():await import(pathToFileURL(createRequire(profile.installAnchor).resolve('@deepseek-ai/dsh-plugin-manager/operations')))
  const atomic=loadAtomic?await loadAtomic():await import(pathToFileURL(createRequire(profile.installAnchor).resolve('@deepseek-ai/dsh-atomic-write')))
  const logPath=path.join(action.storeDir,'dsh.log')
  await atomic.withFileLock(path.join(profile.dir,'package.json'),async()=>{
  if(signal?.aborted)fail('ABORT_ERR','安装已取消')
  let storeDir
  try{storeDir=parseYaml(await readFile(path.join(profile.dir,'node_modules/.modules.yaml'),'utf8'))?.storeDir}catch(e){if(e.code!=='ENOENT')throw e}
  if(storeDir!==undefined&&(typeof storeDir!=='string'||!path.isAbsolute(storeDir)))fail('INVALID_STORE','目标 DSH 的现有 store 路径无效')
  const lockfileArgs=await offlineLockfileArgs(profile.dir)
  if(lockfileArgs.length)onOutput?.('本次离线操作信任与已安装记录一致的旧锁文件，不复审其仓库元数据；保留包完整性校验。\n')
  const result=await operations.runProfilePnpm({...profile,profile:profile.name},['add',action.path,'--offline','--ignore-scripts',...(storeDir?['--store-dir',storeDir]:[]),...lockfileArgs],{
   ...profile.packageManager,execution:'service',signal,outputBytes:262144,lockWaitMs:10000,lookupTimeoutMs:10000,idleTimeoutMs:30000,activateNewBundles:false,
   env:{...profile.packageManager?.env,npm_config_offline:'true',npm_config_ignore_scripts:'true',COREPACK_ENABLE_NETWORK:'0'},onOutput
  })
  await mkdir(action.storeDir,{recursive:true,mode:0o700})
  await writeFile(logPath,result.output??'',{mode:0o600})
  if(signal?.aborted)fail('ABORT_ERR','安装已取消')
  if(result.exitCode!==0||result.timedOut)fail('DSH_INSTALL_FAILED',`DSH 安装未完成：${result.output??'请查看操作日志'}`,{logPath})
  },{waitMs:10000})
  const activated=await pluginManager.setBundleEnabled(action.packageName,true)
  if(activated.error||activated.application==='failed')fail('DSH_ENABLE_FAILED',activated.error?.diagnostic??'文件已安装，但 DSH 未能启用插件',{logPath})
  return{logPath,application:activated.application}
 }}
}
