import path from 'node:path'
import {mkdir,readFile,writeFile} from 'node:fs/promises'
import {assertOwnership} from './ownership.mjs'
import {runHostCommand} from './command.mjs'
import {applyDshCli} from './dsh-cli.mjs'
import {fail} from '../contracts/constants.mjs'

// Runs in the installation's Electron runtime. Keep this function self-contained:
// its source is passed as a literal argv value, without a shell or an app mutation.
export async function runDesktopPackageEntry(input){
 const {createRequire}=await import('node:module'),{setEnvironmentData}=await import('node:worker_threads')
 const {readFile,mkdir,rm}=await import('node:fs/promises'),path=await import('node:path'),{spawn}=await import('node:child_process')
 const require=createRequire(path.join(input.dshRoot,'package.json')),{pathToFileURL}=await import('node:url')
 const load=id=>import(pathToFileURL(require.resolve(id)).href)
 const boot=await load('@deepseek-ai/dsh-app-boot')
 // Desktop's backend verifies peers through the same installation resolution
 // used by Harness. The exported worker bootstrap installs it only in this helper.
 setEnvironmentData('@deepseek-ai/dsh-app-boot/profile-resolution',{resolution:await boot.createRuntimeResolution({installAnchor:path.join(input.dshRoot,'package.json'),home:input.home})})
 await load('@deepseek-ai/dsh-app-boot/worker/profile-resolution-bootstrap')
 const {createGenerationPackageBackend}=await load('dsh-desktop-market-installer/generations/package-backend')
 const {listGenerations,readDesired,withRegistryLock}=await load('dsh-desktop-market-installer/generations/registry')
 const {publishGenerationManifest}=await load('dsh-desktop-market-installer/generations/projection')
 const {withFileLock}=await load('@deepseek-ai/dsh-atomic-write')
 return withFileLock(path.join(input.profileDir,'package.json'),async()=>{
 const {action}=input,privateStore=path.join(action.storeDir,'native-store')
 const environment={...process.env,ELECTRON_RUN_AS_NODE:process.versions.electron?'1':undefined,DSH_HOME:input.home,npm_config_offline:'true',npm_config_ignore_scripts:'true',npm_config_auto_install_peers:'false',npm_config_manage_package_manager_versions:'false',COREPACK_ENABLE_NETWORK:'0'}
 const runInstall=staging=>new Promise((resolve,reject)=>{
  let output=''
  const child=spawn(input.nodePath,[input.pnpmEntry,'add',action.path,'--offline','--ignore-scripts','--ignore-workspace','--config.auto-install-peers=false','--config.manage-package-manager-versions=false','--store-dir',privateStore],{cwd:staging,env:environment,stdio:['ignore','pipe','pipe'],shell:false,windowsHide:true})
  for(const stream of [child.stdout,child.stderr])stream.on('data',b=>{output=(output+b.toString()).slice(-262144);process.stdout.write(b)})
  child.once('error',reject);child.once('close',code=>resolve({code:code??1,output}))
 })
 const backend=createGenerationPackageBackend({dshHome:input.home,dshEntryPath:path.join(input.dshRoot,'lib/bin.js'),nodeExecutablePath:input.nodePath,pnpmEntryPath:input.pnpmEntry,environment,runInstall})
 let mutation
 try{
  if(action.action!=='remove'){
   if(!action.contentRoot)throw Error('Missing inspected Desktop package content')
   const manifest=JSON.parse(await readFile(path.join(action.contentRoot,'package.json'),'utf8'))
   if(manifest.name!==action.packageName||manifest.version!==action.version||!manifest.dsh?.bundle)throw Error('Inspected package identity does not match')
   const issue=boot.evaluatePluginCompatibility(manifest,boot.readProfileVersionExemptions(input.profileDir))
   if(issue&&!issue.exempted)throw Error(boot.pluginCompatibilityWarning(issue))
   for(const file of boot.bundlePatchPaths(action.contentRoot,manifest.dsh.bundle))boot.loadOverlayPatches('dsh',file)
  }
  mutation=action.action==='remove'?await backend.remove({name:action.packageName,onOutput:t=>process.stdout.write(t)}):await backend.install({spec:action.path,kind:'tarball',expectedName:action.packageName,expectedVersion:action.version,autoInstallPeers:false,onOutput:t=>process.stdout.write(t)})
  if(!mutation)return{handled:false}
  if(mutation.packageResult.exitCode!==0)throw Error(mutation.packageResult.output||'Desktop installation failed')
  let packageDir
  if(action.action!=='remove'){
   const enabled=new Set(await readDesired(input.home)),generations=await listGenerations(input.home)
   const generation=generations.find(g=>enabled.has(g.id)&&g.pluginName===action.packageName&&g.version===action.version)
   if(!generation)throw Error('Desktop did not publish the requested plugin version')
   packageDir=path.join(generation.directory,'node_modules',action.packageName)
   const manifest=JSON.parse(await readFile(path.join(packageDir,'package.json'),'utf8'))
   if(manifest.name!==action.packageName||manifest.version!==action.version||!manifest.dsh?.bundle)throw Error('Desktop installed package identity does not match')
   const issue=boot.evaluatePluginCompatibility(manifest,boot.readProfileVersionExemptions(input.profileDir))
   if(issue&&!issue.exempted)throw Error(boot.pluginCompatibilityWarning(issue))
   for(const file of boot.bundlePatchPaths(packageDir,manifest.dsh.bundle))boot.loadOverlayPatches('dsh',file)
   await withRegistryLock(input.home,()=>publishGenerationManifest(input.home,input.profileName,{syncBundles:true}))
  }else await backend.removed?.({name:action.packageName})
  mutation.commit?.()
  return{handled:true,packageDir,logPath:mutation.packageResult.logPath}
 }finally{await rm(privateStore,{recursive:true,force:true}).catch(()=>{})}
 },{waitMs:10000})
}

export async function applyDesktopPackage(host,action,{signal,onOutput,ownershipCheck=assertOwnership}={}){
 if(!host.desktop?.supported||host.profileName!=='web'||!host.capabilities?.writeSession)fail('DESKTOP_CAPABILITY_UNVERIFIED','此 Desktop 尚未适配原生插件安装')
 await ownershipCheck(host.profileDir)
 await mkdir(action.storeDir,{recursive:true,mode:0o700})
 onOutput?.('使用 DSH Desktop 自带安装后端，不重新解析其他插件的依赖。\n')
 const outputFile=path.join(action.storeDir,'desktop-result.json'),logPath=path.join(action.storeDir,'dsh.log')
 const input={home:host.home,profileName:host.profileName,profileDir:host.profileDir,dshRoot:host.dshRoot,runtimeRoot:host.desktop.runtimeRoot,nodePath:host.nodePath,pnpmEntry:path.join(host.desktop.runtimeRoot,'node_modules/pnpm/bin/pnpm.cjs'),action}
 const entry=`const input=JSON.parse(process.argv[1]);const {writeFile}=await import('node:fs/promises');try{const result=await (${runDesktopPackageEntry.toString()})(input);await writeFile(process.argv[2],JSON.stringify(result));}catch(e){console.error(e.message);process.exitCode=1;}`
 const result=await runHostCommand({executable:host.nodePath,args:['--expose-internals','--input-type=module','-e',entry,JSON.stringify(input),outputFile],cwd:host.profileDir,envAllowlist:{...host.runtimeEnv,DSH_HOME:host.home}},{signal,timeoutMs:300000,onOutput})
 await writeFile(logPath,result.stdout+'\n'+result.stderr,{mode:0o600})
 if(result.exitCode)fail('DSH_DESKTOP_INSTALL_FAILED',`Desktop 插件安装未完成；日志：${logPath}`,{logPath,exitCode:result.exitCode})
 const installed=JSON.parse(await readFile(outputFile,'utf8'))
 if(!installed.handled)return applyDshCli(host,action,{signal,onOutput,ownershipCheck})
 const composed=await runHostCommand({executable:host.nodePath,args:[...host.launch.args,'--dump-config'],cwd:host.profileDir,envAllowlist:{...host.runtimeEnv,DSH_HOME:host.home}},{signal,timeoutMs:120000})
 if(composed.exitCode||/skipping profile bundle|failed to import/i.test(composed.stderr)){await writeFile(logPath,result.stdout+'\n'+result.stderr+'\n'+composed.stderr,{mode:0o600});fail('COMPOSE_FAILED',`DSH 配置检查未通过；日志：${logPath}`)}
 return{...installed,logPath}
}
