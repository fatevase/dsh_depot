import {readFile,realpath,readdir,stat} from 'node:fs/promises'
import {createRequire} from 'node:module'
import path from 'node:path'
import os from 'node:os'
import {createHash} from 'node:crypto'
import {validateHost} from '../contracts/validate.mjs'
import {fail} from '../contracts/constants.mjs'
import {ownershipFacts} from './ownership.mjs'
import {runHostCommand} from './command.mjs'
import {locateInstallations,desktopAt} from './locate.mjs'
export const hash=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex')
export async function json(file,fallback){try{return JSON.parse(await readFile(file,'utf8'))}catch(e){if(e.code==='ENOENT'&&fallback!==undefined)return fallback;throw e}}
export async function hostFingerprint(host){
 const dir=await realpath(host.profileDir),pkg=await readFile(path.join(dir,'package.json'),'utf8');let lock='';for(const f of ['pnpm-lock.yaml','pnpm-workspace.yaml','cordis.yml'])try{lock+=await readFile(path.join(dir,f),'utf8')}catch(e){if(e.code!=='ENOENT')throw e}
 return hash({dir,pkg,lock,root:await realpath(host.dshRoot),node:await realpath(host.nodePath),version:host.version,runtime:host.runtime})
}
export async function probeHost(candidate){
 const profileName=candidate.profileName??'web';if(profileName==='desktop'&&candidate.kind!=='official-desktop')fail('DESKTOP_OWNER_REQUIRED','npm DSH 不能管理官方桌面配置')
 if(!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(profileName))fail('INVALID_PROFILE','配置名称无效')
 const dshRoot=await realpath(candidate.dshRoot),pkg=await json(path.join(dshRoot,'package.json'))
 if(pkg.name!=='@deepseek-ai/dsh')fail('INVALID_DSH','所选目录不是 DSH 安装')
 const profileDir=await realpath(candidate.profileDir??path.join(candidate.home,'profiles',profileName));const profile=await json(path.join(profileDir,'package.json'));const home=await realpath(candidate.home??path.resolve(profileDir,'../..'));let desktopOwned=!!profile.dsh?.desktop;for(const ownerHome of new Set([home,path.resolve(profileDir,'../..')]))try{desktopOwned||=(await stat(path.join(ownerHome,'.desktop-install-state.json'))).isFile()}catch{};if(desktopOwned&&candidate.kind!=='official-desktop')fail('DESKTOP_OWNER_REQUIRED','此配置由 DSH Desktop 管理，不能按 npm CLI 修改')
 if(!candidate.nodePath)fail('HOST_RUNTIME_REQUIRED','请明确选择实际 DSH 使用的 Node；不能使用安装器 Node 代替')
 const nodePath=await realpath(candidate.nodePath)
 const ownership=await ownershipFacts(profileDir),ownerId=ownership.ownerId,owned=!ownership.elevated&&ownership.ownerId===ownership.currentId
 const runtime=await runHostCommand({executable:nodePath,args:['-e','console.log(JSON.stringify({source:"host",kind:process.versions.electron?"electron":"node",platform:process.platform,arch:process.arch,node:process.versions.node,abi:process.versions.modules,napi:+process.versions.napi,libc:process.platform==="linux"?{name:process.report.getReport().header.glibcVersionRuntime?"glibc":"unknown",version:process.report.getReport().header.glibcVersionRuntime??""}:null}))'],cwd:profileDir,envAllowlist:candidate.runtimeEnv},{timeoutMs:10000})
 if(runtime.exitCode)fail('HOST_RUNTIME_REQUIRED','无法检查所选宿主 Node')
 const observed=JSON.parse(runtime.stdout.trim()),req=createRequire(path.join(dshRoot,'package.json'));let operations=false
 try{req.resolve('@deepseek-ai/dsh-plugin-manager/operations');req.resolve('@deepseek-ai/dsh-atomic-write');operations=pkg.version==='0.2.0-rc.2'}catch{}
 const kind=candidate.kind??'cli-web';operations=operations&&owned
 let desktop
 if(kind==='official-desktop'){
  desktop=candidate.desktop&&await desktopAt(candidate.desktop.appPath)
  operations=operations&&!!desktop?.supported&&process.versions.electron!==undefined&&observed.kind==='electron'&&nodePath.startsWith(desktop.appPath+path.sep)&&dshRoot===await realpath(path.join(desktop.runtimeRoot,'node_modules/@deepseek-ai/dsh'))
 }
 const host={schemaVersion:1,hostId:hash({dshRoot,profileDir}).slice(0,24),kind,version:pkg.version,profileName,profileDir,home:await realpath(candidate.home??path.resolve(profileDir,'../..')),dshRoot,nodePath,ownerId,runtime:observed,launch:{executable:nodePath,args:['--expose-internals',path.join(dshRoot,'lib/bin.js'),'--profile',profileName]},packageManager:candidate.packageManager??{command:'pnpm',args:[]},capabilities:{inspect:true,offlineInstall:operations,remove:operations,writeSession:operations,requiresExit:false,survivesHostExit:false,blockedReason:operations?null:!owned?'PROFILE_OWNER_MISMATCH':'HOST_CAPABILITY_UNVERIFIED'}}
 if(kind==='official-desktop'){host.desktop=desktop;host.runtimeEnv={ELECTRON_RUN_AS_NODE:'1'}}
 host.fingerprint=await hostFingerprint(host);return validateHost(host)
}
export async function discoverEnvironments(options={}){
 const found=await locateInstallations(options),hosts=await discoverHosts({...options,locations:found.locations,onIssue:issue=>{if(!['ENOENT','ENOTDIR'].includes(issue.code)){found.issues.push(issue);options.onIssue?.(issue)}}})
 return{...found,hosts}
}
export async function discoverHosts({env=process.env,locations,onIssue,...options}={}){
 if(!locations)locations=(await locateInstallations({env,onIssue,...options})).locations
 const hosts=new Map();for(const candidate of locations){try{const h=await probeHost(candidate);hosts.set(h.hostId,h)}catch(e){onIssue?.({candidate,code:e.code??'HOST_PROBE_FAILED',message:e.message})}}
 return [...hosts.values()]
}
