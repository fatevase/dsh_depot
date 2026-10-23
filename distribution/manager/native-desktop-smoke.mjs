// Runs only against an explicit, extracted official Desktop in a disposable home.
import path from 'node:path'
import {fileURLToPath,pathToFileURL} from 'node:url'
import {mkdir,readFile,writeFile,rm,cp,readdir,rename} from 'node:fs/promises'
import {runTerminalChild} from '../../plugins/dsh-depot-manager/bootstrap/terminal-bridge.mjs'
import {runHostCommand} from '../../plugins/dsh-depot-manager/adapters/command.mjs'
import {desktopPackageManager,desktopPnpmEnvironment} from '../../plugins/dsh-depot-manager/adapters/host-pnpm.mjs'
import * as tar from 'tar'
import {spawn} from 'node:child_process'
import {desktopAt} from '../../plugins/dsh-depot-manager/adapters/locate.mjs'
import {probeHost,discoverEnvironments} from '../../plugins/dsh-depot-manager/adapters/discover.mjs'
import {inspectArtifact} from '../../plugins/dsh-depot-manager/core/inspect.mjs'
import {createOperationPlan} from '../../plugins/dsh-depot-manager/core/plans.mjs'
import {executePlan} from '../../plugins/dsh-depot-manager/core/operations.mjs'
import {officialDesktopAdapter} from '../../plugins/dsh-depot-manager/adapters/official-desktop.mjs'
import {fileHash,atomicJson} from '../../plugins/dsh-depot-manager/core/files.mjs'

export async function nativeDesktopSmoke(app,output){
 app=path.resolve(app);output=path.resolve(output)
 const desktop=await desktopAt(app)
 if(!desktop?.supported||desktop.layout!=='bundled-cli')throw Error('Explicit official Desktop with bundled CLI required')
 const receipt=JSON.parse(await readFile(path.join(output,'receipt.json'))),work=path.join(output,'native-desktop'),home=path.join(work,'home')
 await mkdir(work,{recursive:true})
 if(!process.versions.electron){
  return new Promise((resolve,reject)=>{
   const log=[];const child=spawn(desktop.executable,['--expose-internals',fileURLToPath(import.meta.url),app,output],{shell:false,stdio:['ignore','pipe','pipe'],env:{...process.env,ELECTRON_RUN_AS_NODE:'1',DSH_DEPOT_DESKTOP_APP:app,DSH_HOME:home,XDG_CACHE_HOME:path.join(work,'cache')}})
   for(const stream of [child.stdout,child.stderr])stream.on('data',b=>{log.push(b);process.stdout.write(b)})
   const timer=setTimeout(()=>child.kill(),180000)
   child.once('error',e=>{clearTimeout(timer);reject(e)})
   child.once('close',async code=>{clearTimeout(timer);await writeFile(path.join(work,'smoke.log'),Buffer.concat(log));code===0?resolve():reject(Error('Native Desktop smoke failed: '+code))})
  })
 }
 if(path.resolve(process.env.DSH_HOME??'')!==home)throw Error('Disposable DSH_HOME required')
 const profileDir=path.join(home,'profiles/desktop'),dshRoot=path.join(desktop.runtimeRoot,'node_modules/@deepseek-ai/dsh')
 const boot=await import(pathToFileURL(path.join(desktop.runtimeRoot,'node_modules/@deepseek-ai/dsh-app-boot/lib/index.js')))
 await mkdir(profileDir,{recursive:true});boot.initProfile(profileDir,boot.PROFILE_TEMPLATES.web.bundles)
 // Same API used by Desktop initialization; isolate pnpm's store for this regression.
 await writeFile(path.join(profileDir,'pnpm-workspace.yaml'),'packages:\n  - .\nnodeLinker: hoisted\nautoInstallPeers: false\nstoreDir: '+JSON.stringify(path.join(work,'store'))+'\n')
 const found=await discoverEnvironments({env:{...process.env,DSH_DEPOT_DESKTOP_APP:app},paths:[app],processes:[]})
 if(!found.hosts.some(h=>h.kind==='official-desktop'&&h.profileName==='desktop'))throw Error('Native Desktop profile discovery failed: '+JSON.stringify(found.issues))
 const host=await probeHost({kind:'official-desktop',desktop,home,profileName:'desktop',dshRoot,nodePath:process.execPath,runtimeEnv:{ELECTRON_RUN_AS_NODE:'1'}})
 const elevatedCi=process.platform==='win32'&&process.env.GITHUB_ACTIONS==='true'&&process.env.RUNNER_ENVIRONMENT==='github-hosted'&&host.capabilities.blockedReason==='PROFILE_OWNER_MISMATCH'
 if(elevatedCi){
  host.capabilities={...host.capabilities,writeSession:true,offlineInstall:true,remove:true}
  // probeHost deliberately withholds the carrier for an elevated process.
  // This existing CI-only admission applies to the disposable test profile.
  host.packageManager=await desktopPackageManager(desktop,{nodePath:host.nodePath})
  host.runtimeEnv=desktopPnpmEnvironment(host.packageManager)
 }
 // An empty profile cannot expose registry-metadata revalidation. Seed an
 // ordinary dependency online, then clear only this disposable metadata cache.
 const cache=path.join(work,'pnpm-cache'),cacheEnv={npm_config_cache_dir:cache,pnpm_config_cache_dir:cache,PNPM_CONFIG_CACHE_DIR:cache}
 const seeded=await runHostCommand({executable:host.packageManager.command,args:[...host.packageManager.args,'add','@deepseek-ai/cosmokit@1.8.6','--ignore-scripts','--registry=https://registry.npmjs.org','--config.cache-dir='+cache],cwd:profileDir,envAllowlist:{...host.runtimeEnv,...host.packageManager.env,...cacheEnv}},{timeoutMs:120000})
 await writeFile(path.join(work,'existing-profile-setup.log'),seeded.stdout+'\n'+seeded.stderr)
 if(seeded.exitCode)throw Error('Existing-profile setup failed: '+seeded.stderr)
 const existingFile=path.join(profileDir,'node_modules/@deepseek-ai/cosmokit/package.json'),existingBytes=await readFile(existingFile,'utf8')
 const pmVersion=JSON.parse(await readFile(path.join(desktop.resources,'runtime/primary-runtime/dependencies/pnpm/package.json'))).version
 const legacyResolverCache=Number(pmVersion.split('.')[0])<12
 const savedCache=path.join(work,'setup-cache');await rename(cache,savedCache);await mkdir(cache,{recursive:true})
 // Legacy JS pnpm also needs its ordinary resolver metadata for a hoisted add.
 // Keep that separate from the supply-chain metadata/verification cache under test.
 if(legacyResolverCache)for(const version of await readdir(savedCache))if(/^v[0-9]+$/.test(version)){
  await mkdir(path.join(cache,version),{recursive:true})
  for(const name of ['metadata-full','metadata'])try{await cp(path.join(savedCache,version,name),path.join(cache,version,'metadata'),{recursive:true})}catch(e){if(e.code!=='ENOENT')throw e}
 }
 await rm(savedCache,{recursive:true,force:true})
 const archive=path.join(output,receipt.manager.fileName),adapter=officialDesktopAdapter({runningProbe:async()=>false,...(elevatedCi?{ownershipCheck:async()=>{}}:{})}),operations=[]
 for(const action of ['install','install','remove']){
  const fresh=await probeHost(host);fresh.runtimeEnv={...fresh.runtimeEnv,...cacheEnv};if(elevatedCi)fresh.capabilities={...fresh.capabilities,writeSession:true,offlineInstall:true,remove:true}
  const inspection=action==='remove'?undefined:await inspectArtifact({path:archive,host:fresh,workDir:path.join(work,'imports')})
  const plan=await createOperationPlan({host:fresh,inspection,action,packageName:action==='remove'?'dsh-depot-manager':undefined,installedFingerprint:action==='remove'?'native-smoke':undefined,acceptUnverified:true})
  let commandOutput=''
  const op=await executePlan(plan,{host:fresh,adapter,storeDir:path.join(work,'tasks'),quiesced:true,onOutput:s=>{commandOutput+=s;process.stdout.write(s)}})
  operations.push({action,state:op.state,error:op.error})
  if(!['awaiting_reload','succeeded'].includes(op.state))throw Error(JSON.stringify(op.error))
  if(!commandOutput.includes('与已安装记录一致'))throw Error('Existing-profile offline strategy was not exercised')
  if(await readFile(existingFile,'utf8')!==existingBytes)throw Error('Offline operation changed the existing registry dependency')
 }
 const lite=receipt.assets?.find(a=>a.flavor==='lite')
 if(!lite)throw Error('Packaged lite installer required for terminal handoff regression')
 const extraction=path.join(work,'bootstrap with spaces'),bundleArchive=path.join(output,lite.fileName)
 await mkdir(extraction,{recursive:true})
 if(process.platform==='win32'){
  const r=await runHostCommand({executable:'python',args:['-c','import sys,zipfile;zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])',bundleArchive,extraction],cwd:work})
  if(r.exitCode)throw Error('Cannot extract installer: '+r.stderr)
 }else await tar.x({file:bundleArchive,cwd:extraction})
 const bundleRoot=path.join(extraction,lite.fileName.replace(/\.(?:tgz|zip)$/,'')),consoleNode=path.join(desktop.resources,'runtime/primary-runtime/dependencies/node/bin',process.platform==='win32'?'node.exe':'node')
 const terminalOutput=[];let promptCount=0
 const terminalCode=await runTerminalChild(consoleNode,[path.join(bundleRoot,'core.mjs'),'menu'],{
  env:{...process.env,DSH_DEPOT_HOME:path.join(work,'toolkit-store')},
  io:{isTTY:true,write:s=>terminalOutput.push(s),ask:async()=>{if(++promptCount>2)throw Error('Unexpected extra prompt');const text=terminalOutput.join('');if(text.includes('5. 恢复任务'))return 'q';const row=text.split('\n').find(l=>l.includes('DSH Desktop '+desktop.version+' / 使用应用自带 DSH'));const choice=row?.match(/^([0-9]+)\./)?.[1];if(!choice)throw Error('Expected Desktop or action menu');return choice}}
 })
 const terminalLog=terminalOutput.join('');await writeFile(path.join(work,'terminal-handoff.log'),terminalLog)
 if(terminalCode!==0||!promptCount||!terminalLog.includes('使用应用自带 DSH')||!terminalLog.includes('5. 恢复任务')||terminalLog.includes('INPUT_REQUIRED'))throw Error('Packaged Node → Desktop terminal handoff failed: '+terminalLog)
 const report={schemaVersion:1,status:'passed',desktopVersion:desktop.version,dshVersion:host.version,target:host.target,runtime:host.runtime,managerSha256:await fileHash(archive),operations,coverage:'isolated-official-cli-install-reinstall-remove-and-packaged-terminal-handoff',existingProfile:{status:'passed',dependency:'@deepseek-ai/cosmokit@1.8.6',pnpmVersion:pmVersion,supplyChainMetadataCache:'empty',resolverMetadataCache:legacyResolverCache?'prepared-from-online-setup':'empty',existingPackagePreserved:true},terminalHandoff:{status:'passed',prompts:promptCount,consoleOwner:'parent',childStdio:'ipc-without-tty'},ownership:elevatedCi?'unverified-elevated-ci-carrier-test':'passed',ui:'unverified',networkIsolation:'unverified',createdAt:new Date().toISOString()}
 await atomicJson(path.join(output,'native-desktop.json'),report)
 receipt.verification.nativeDesktop=report
 await atomicJson(path.join(output,'receipt.json'),receipt)
 console.log('Native Desktop install / reinstall / remove passed')
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))nativeDesktopSmoke(...process.argv.slice(2)).catch(e=>{console.error(e);process.exitCode=1})
