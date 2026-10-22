// Runs only against an explicit, extracted official Desktop in a disposable home.
import path from 'node:path'
import {fileURLToPath,pathToFileURL} from 'node:url'
import {mkdir,readFile,writeFile} from 'node:fs/promises'
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
 if(elevatedCi){host.capabilities={...host.capabilities,writeSession:true,offlineInstall:true,remove:true}}
 const archive=path.join(output,receipt.manager.fileName),adapter=officialDesktopAdapter({runningProbe:async()=>false,...(elevatedCi?{ownershipCheck:async()=>{}}:{})}),operations=[]
 for(const action of ['install','install','remove']){
  const fresh=await probeHost(host);if(elevatedCi)fresh.capabilities={...fresh.capabilities,writeSession:true,offlineInstall:true,remove:true}
  const inspection=action==='remove'?undefined:await inspectArtifact({path:archive,host:fresh,workDir:path.join(work,'imports')})
  const plan=await createOperationPlan({host:fresh,inspection,action,packageName:action==='remove'?'dsh-depot-manager':undefined,installedFingerprint:action==='remove'?'native-smoke':undefined,acceptUnverified:true})
  const op=await executePlan(plan,{host:fresh,adapter,storeDir:path.join(work,'tasks'),quiesced:true,onOutput:s=>process.stdout.write(s)})
  operations.push({action,state:op.state,error:op.error})
  if(!['awaiting_reload','succeeded'].includes(op.state))throw Error(JSON.stringify(op.error))
 }
 const report={schemaVersion:1,status:'passed',desktopVersion:desktop.version,dshVersion:host.version,target:host.target,runtime:host.runtime,managerSha256:await fileHash(archive),operations,coverage:'isolated-official-cli-install-reinstall-remove',ownership:elevatedCi?'unverified-elevated-ci-carrier-test':'passed',ui:'unverified',networkIsolation:'unverified',createdAt:new Date().toISOString()}
 await atomicJson(path.join(output,'native-desktop.json'),report)
 receipt.verification.nativeDesktop=report
 await atomicJson(path.join(output,'receipt.json'),receipt)
 console.log('Native Desktop install / reinstall / remove passed')
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))nativeDesktopSmoke(...process.argv.slice(2)).catch(e=>{console.error(e);process.exitCode=1})
