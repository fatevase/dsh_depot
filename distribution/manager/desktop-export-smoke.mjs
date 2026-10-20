// Optional macOS Desktop 0.12.0 probe. Uses newly created disposable profiles only.
import path from 'node:path'
import {mkdir,writeFile,readFile} from 'node:fs/promises'
import {spawn} from 'node:child_process'
import {setTimeout as delay} from 'node:timers/promises'
import {fileURLToPath} from 'node:url'
import * as tar from 'tar'
import {createExportFixture} from './export-roundtrip.mjs'
import {desktopAt} from '../../plugins/dsh-depot-manager/adapters/locate.mjs'
import {probeHost} from '../../plugins/dsh-depot-manager/adapters/discover.mjs'
import {applyDshCli} from '../../plugins/dsh-depot-manager/adapters/dsh-cli.mjs'
import {atomicJson,fileHash} from '@dsh-depot/offline-format/files'
import {isolatedEnv,redact} from '../lib/process.mjs'
export async function desktopExportSmoke({workDir,managerArchive}){
 if(!process.versions.electron)throw Error('Run with Desktop Electron in ELECTRON_RUN_AS_NODE mode')
 workDir=path.resolve(workDir);await mkdir(workDir,{recursive:false,mode:0o700})
 const desktop=await desktopAt('/Applications/DSH Desktop.app');if(!desktop?.supported)throw Error('Desktop 0.12.0 required')
 const env={...await isolatedEnv(path.join(workDir,'environment')),ELECTRON_RUN_AS_NODE:'1',DSH_DEPOT_HOME:path.join(workDir,'depot')}
 async function target(name){const home=path.join(workDir,name),profileDir=path.join(home,'profiles/web');await mkdir(profileDir,{recursive:true});await atomicJson(path.join(profileDir,'package.json'),{name:'export-smoke-profile',private:true,type:'module',dependencies:{},dsh:{profile:{bundles:['@deepseek-ai/dsh-base','@deepseek-ai/dsh-web-app']}}});await writeFile(path.join(profileDir,'pnpm-workspace.yaml'),'packages:\n  - .\nnodeLinker: hoisted\nautoInstallPeers: false\n');const host=await probeHost({kind:'official-desktop',desktop,home,profileDir,profileName:'web',dshRoot:path.join(desktop.runtimeRoot,'node_modules/@deepseek-ai/dsh'),nodePath:process.execPath,runtimeEnv:env});host.runtimeEnv={...env,...host.runtimeEnv};return host}
 const source=await target('source-home'),fixture=await createExportFixture(workDir),fixtureArchive=path.join(workDir,'fixture.tgz')
 await tar.c({file:fixtureArchive,gzip:true,cwd:path.dirname(fixture.root),portable:true},['package'])
 for(const archive of [path.resolve(managerArchive),fixtureArchive])await applyDshCli(source,{action:'install',path:archive,storeDir:path.join(workDir,'source-install')})
 const manifestBefore=await readFile(path.join(source.profileDir,'package.json')),child=spawn(source.nodePath,[...source.launch.args,'--no-open','--host','127.0.0.1','--port','0'],{env:{...env,...source.runtimeEnv,DSH_HOME:source.home},stdio:['ignore','pipe','pipe'],detached:true})
 let logs='',ended=false;child.stdout.on('data',b=>logs+=b);child.stderr.on('data',b=>logs+=b);child.on('exit',()=>ended=true)
 try{
  let url;for(let i=0;i<600&&!ended;i++){url=logs.match(/dsh web:\s*(http:\/\/127\.0\.0\.1:\d+\/[^\s]*)/)?.[1];if(url)break;await delay(100)}if(!url)throw Error('Desktop host not ready: '+redact(logs.slice(-3000)))
  const origin=new URL(url).origin,auth=await fetch(url,{redirect:'manual'}),cookie=auth.headers.get('set-cookie')?.split(';')[0]??''
  const rpc=async(method,input={})=>{const r=await fetch(origin+'/api/depot/rpc',{method:'POST',headers:{cookie,origin,'content-type':'application/json'},body:JSON.stringify({method,input})});const body=await r.json();if(!body.ok)throw Error(JSON.stringify(body.error));return body.value}
  const inventory=await rpc('installed.list'),item=inventory.find(i=>i.name===fixture.name),manager=inventory.find(i=>i.name==='dsh-depot-manager');if(!item?.exportable||!manager?.exportable||!manager.protected)throw Error('Wrong inventory export eligibility')
  const job=await rpc('exports.create',{packageName:item.name,installedFingerprint:item.fingerprint});let ready
  for(let i=0;i<600;i++){ready=await rpc('exports.status',{exportId:job.exportId});if(['ready','failed','cancelled'].includes(ready.state))break;await delay(100)}if(ready?.state!=='ready')throw Error(JSON.stringify(ready))
  const denied=await fetch(origin+ready.downloadUrl,{redirect:'manual'});if(denied.status===200)throw Error('Anonymous download admitted')
  const download=await fetch(origin+ready.downloadUrl,{headers:{cookie}});if(download.status!==200)throw Error('Authenticated download failed');const archive=path.join(workDir,ready.fileName);await writeFile(archive,Buffer.from(await download.arrayBuffer()));if(await fileHash(archive)!==ready.sha256)throw Error('Downloaded bytes differ')
  const ownJob=await rpc('exports.create',{packageName:manager.name,installedFingerprint:manager.fingerprint});let ownReady;for(let i=0;i<600;i++){ownReady=await rpc('exports.status',{exportId:ownJob.exportId});if(['ready','failed','cancelled'].includes(ownReady.state))break;await delay(100)}if(ownReady?.state!=='ready')throw Error('Manager self-export failed: '+JSON.stringify(ownReady))
  const dest=await target('target-home');await applyDshCli(dest,{action:'install',path:archive,storeDir:path.join(workDir,'target-install')})
  const report={schemaVersion:1,status:'passed',desktopVersion:desktop.version,node:process.versions.node,managerVersion:manager.version,managerSha256:await fileHash(path.resolve(managerArchive)),managerSelfExport:true,authenticatedExport:true,anonymousDownloadStatus:denied.status,backgroundWorker:true,targetInstallAndCompose:true,sourceConfigUnchanged:manifestBefore.equals(await readFile(path.join(source.profileDir,'package.json'))),artifact:{fileName:ready.fileName,sha256:ready.sha256,compressedBytes:ready.compressedBytes},networkIsolation:'not claimed by this Desktop smoke; separate stock DSH roundtrip provides OS isolation'}
  if(!report.sourceConfigUnchanged)throw Error('Source changed');await atomicJson(path.join(workDir,'desktop-export-smoke.json'),report);return report
 }finally{try{process.kill(-child.pid,'SIGTERM')}catch{};for(let i=0;i<30&&!ended;i++)await delay(100);if(!ended)try{process.kill(-child.pid,'SIGKILL')}catch{};await writeFile(path.join(workDir,'desktop-host.log'),redact(logs))}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))desktopExportSmoke({workDir:process.argv[2],managerArchive:process.argv[3]}).then(r=>console.log(JSON.stringify(r)),e=>{console.error(e);process.exitCode=1})
