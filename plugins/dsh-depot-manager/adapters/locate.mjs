// Bounded local discovery only: no recursive disk scan, shell evaluation or network.
import {readFile,realpath,readdir,stat} from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import {runHostCommand} from './command.mjs'
import {desktopAt} from './desktop-layout.mjs'
export {desktopAt} from './desktop-layout.mjs'
const json=async file=>JSON.parse(await readFile(file,'utf8'))
const canonical=async file=>{try{return await realpath(file)}catch{return null}}
async function packageRoot(file){
 let current=await canonical(file);if(!current)return null
 if(!(await stat(current)).isDirectory())current=path.dirname(current)
 for(let depth=0;depth<8;depth++){
  if(path.basename(current)==='.bin'){const sibling=await canonical(path.join(current,'../@deepseek-ai/dsh'));if(sibling)try{if((await json(path.join(sibling,'package.json'))).name==='@deepseek-ai/dsh')return sibling}catch{}}
  try{if((await json(path.join(current,'package.json'))).name==='@deepseek-ai/dsh')return current}catch{}
  const parent=path.dirname(current);if(parent===current)break;current=parent
 }
 return null
}
async function nodeFor(root,env){
 if(env.DSH_DEPOT_NODE)return canonical(env.DSH_DEPOT_NODE)
 let dir=root
 for(let i=0;i<7;i++){for(const file of [path.join(dir,'bin','node'),path.join(dir,'node.exe')]){const p=await canonical(file);if(p)return p}const parent=path.dirname(dir);if(parent===dir)break;dir=parent}
 for(const dir of (env.PATH??env.Path??'').split(path.delimiter).filter(Boolean)){const p=await canonical(path.join(dir,process.platform==='win32'?'node.exe':'node'));if(p)return p}
 return null
}
export async function runningProcesses(){
 const windows=process.platform==='win32'
 const command=windows?{executable:'powershell.exe',args:['-NoProfile','-NonInteractive','-Command',"$ErrorActionPreference='Stop'; $env:PSModulePath=[IO.Path]::Combine($PSHOME,'Modules'); Get-CimInstance Win32_Process | Where-Object { $_.Name -match '^(node|dsh|DSH Desktop|dsh-desktop|DeepSeek Harness)(\\.exe)?$' } | Select-Object ProcessId,ExecutablePath,CommandLine | ConvertTo-Json -Compress"]}:{executable:'ps',args:['-u',String(process.getuid()),'-o','pid=,args=']}
 const r=await runHostCommand({...command,cwd:os.tmpdir()},{timeoutMs:10000,maxBytes:8*1024*1024})
 if(r.exitCode||r.stdout.length>=8*1024*1024)throw Object.assign(new Error('进程查找不可用；仍可使用路径查找和手动输入'),{code:'PROCESS_DISCOVERY_UNAVAILABLE'})
 return windows?[].concat(JSON.parse(r.stdout||'[]')).filter(Boolean).map(p=>({pid:p.ProcessId,executable:p.ExecutablePath,command:p.CommandLine??''})):r.stdout.split('\n').map(line=>{const m=line.trim().match(/^(\d+)\s+(.*)$/);return m?{pid:+m[1],command:m[2]}:null}).filter(Boolean)
}
export function desktopRegistryPaths(rows){
 return [...new Set([].concat(rows??[]).filter(row=>/^(?:DeepSeek Harness|DSH Desktop)(?:\s+\d[^\r\n]*)?$/.test(row?.DisplayName??'')&&typeof row.InstallLocation==='string'&&path.win32.isAbsolute(row.InstallLocation)).map(row=>row.InstallLocation))].slice(0,32)
}
export async function windowsDesktopPaths(){
 const script="$ErrorActionPreference='Stop'; $roots=@('HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'); @(Get-ItemProperty -Path $roots -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -match '^(DeepSeek Harness|DSH Desktop)'  -and $_.InstallLocation } | Select-Object -First 128 DisplayName,InstallLocation) | ConvertTo-Json -Compress"
 const result=await runHostCommand({executable:'powershell.exe',args:['-NoProfile','-NonInteractive','-Command',script],cwd:os.tmpdir()},{timeoutMs:10000,maxBytes:32768})
 if(result.exitCode||result.stdout.length>=32768)throw Object.assign(Error('无法读取 Desktop 安装位置；仍可手动指定安装目录或 EXE'),{code:'DESKTOP_REGISTRY_UNAVAILABLE'})
 return desktopRegistryPaths(JSON.parse(result.stdout||'[]'))
}
async function workingDirectory(pid){
 if(!Number.isSafeInteger(pid)||pid<=0)return null
 if(process.platform==='linux')return canonical('/proc/'+pid+'/cwd')
 if(process.platform==='darwin'){const r=await runHostCommand({executable:'/usr/sbin/lsof',args:['-a','-p',String(pid),'-d','cwd','-Fn'],cwd:os.tmpdir()},{timeoutMs:3000,maxBytes:16384});return r.stdout.split('\n').find(x=>x.startsWith('n'))?.slice(1)??null}
 return null
}
export async function locateInstallations({env=process.env,paths=[],processes,userHome=os.homedir(),onIssue}={}){
 const roots=new Map(),processNodes=new Map(),homes=new Set([env.DSH_HOME??path.join(userHome,'.dsh')]),desktop=new Map(),issues=[]
 const issue=e=>{const record={code:e.code??'DISCOVERY_FAILED',message:e.message};issues.push(record);onIssue?.(record)}
 const desktopHomes=[process.platform==='darwin'?path.join(userHome,'Library/Application Support/dsh-desktop/harness'):process.platform==='win32'?path.join(env.APPDATA??path.join(userHome,'AppData/Roaming'),'dsh-desktop/harness'):path.join(env.XDG_CONFIG_HOME??path.join(userHome,'.config'),'dsh-desktop/harness')]
 async function addHome(input){
  let dir=await canonical(input);if(!dir)return
  if(!(await stat(dir)).isDirectory())dir=path.dirname(dir)
  for(let i=0;i<3;i++){try{if((await stat(path.join(dir,'profiles'))).isDirectory()){let desktopOwned=false;try{desktopOwned=(await stat(path.join(dir,'.desktop-install-state.json'))).isFile()}catch{};if(desktopOwned)desktopHomes.push(dir);else homes.add(dir)}}catch{}const parent=path.dirname(dir);if(parent===dir)break;dir=parent}
 }
 async function addPath(input,node){
  if(!input)return
  const d=await desktopAt(input)
  if(d){desktop.set(d.appPath,{...d,homes:[...desktopHomes]});return}
  const root=await packageRoot(input)
  if(root){
   if(env.DSH_DEPOT_NODE)roots.set(root,await canonical(env.DSH_DEPOT_NODE))
   else if(node){const nodes=processNodes.get(root)??new Set(),before=nodes.size;nodes.add(node);processNodes.set(root,nodes);roots.set(root,nodes.size===1?node:undefined);if(before===1&&nodes.size===2)issue({code:'HOST_RUNTIME_AMBIGUOUS',message:'同一 DSH 安装存在不同运行时，请在 settings.json 的 hostNode 中明确选择：'+root})}
   else if(!roots.has(root))roots.set(root,await nodeFor(root,env))
  }
  await addHome(input);return root
 }
 const standardRoots=[env.DSH_DEPOT_DSH_ROOT,path.join(env.APPDATA??userHome,'npm/node_modules/@deepseek-ai/dsh'),'/opt/homebrew/lib/node_modules/@deepseek-ai/dsh','/usr/local/lib/node_modules/@deepseek-ai/dsh']
 const apps=process.platform==='darwin'?['/Applications/DeepSeek Harness.app',path.join(userHome,'Applications/DeepSeek Harness.app'),'/Applications/DSH Desktop.app',path.join(userHome,'Applications/DSH Desktop.app')]:process.platform==='win32'?[path.join(env.LOCALAPPDATA??path.join(userHome,'AppData/Local'),'Programs/DeepSeek Harness'),path.join(env.ProgramFiles??'C:\\Program Files','DeepSeek Harness'),path.join(env.LOCALAPPDATA??path.join(userHome,'AppData/Local'),'Programs/DSH Desktop'),path.join(env.LOCALAPPDATA??path.join(userHome,'AppData/Local'),'Programs/dsh-desktop'),path.join(env.ProgramFiles??'C:\\Program Files','DSH Desktop')]:['/opt/DSH Desktop','/opt/dsh-desktop','/usr/lib/dsh-desktop']
 if(process.platform==='win32')try{apps.push(...await windowsDesktopPaths())}catch(e){issue(e)}
 for(const input of [...standardRoots,...apps,env.DSH_DEPOT_DESKTOP_APP,...paths].filter(Boolean))await addPath(input)
 for(const dir of (env.PATH??env.Path??'').split(path.delimiter).filter(Boolean)){
  for(const name of process.platform==='win32'?['dsh.cmd','dsh.exe','dsh-desktop.exe','DSH Desktop.exe','DeepSeek Harness.exe']:['dsh','dsh-desktop'])await addPath(path.join(dir,name))
  await addPath(path.join(dir,'node_modules/@deepseek-ai/dsh'));await addPath(path.join(dir,'../lib/node_modules/@deepseek-ai/dsh'))
 }
 if(processes===undefined)try{processes=await runningProcesses()}catch(e){issue(e);processes=[]}
 let inspected=0
 for(const row of processes){
  const text=row.command??'';if(row.pid===process.pid||!/(?:dsh|DeepSeek Harness|lib[/\\]bin\.js)/i.test(text+' '+(row.executable??''))||inspected++>=32)continue
  const data=text.match(/--user-data-dir(?:=|\s+)("[^"]+"|'[^']+'|.*?)(?=\s+--[a-zA-Z]|$)/);if(data){const value=data[1].replace(/^["']|["']$/g,'');const home=await canonical(path.join(value,'harness'));if(home)desktopHomes.push(home)}
  const appMatch=text.match(/^"?(.*?\.app)(?:[/\\]|\s)/i);if(appMatch){await addPath(appMatch[1]);continue}
  const desktopExe=text.match(/^"?(.+?[/\\](?:dsh-desktop|DSH Desktop|DeepSeek Harness)(?:\.exe)?)"?(?=\s|$)/i);if(desktopExe)await addPath(desktopExe[1])
  if(row.executable)await addPath(row.executable)
  const m=text.match(/^(?:"([^"]+)"|(.+?[/\\]node(?:\.exe)?|node(?:\.exe)?))(?=\s|$)/i);if(!m)continue
  const node=await canonical(m[1]??m[2]);if(!node)continue
  let cwd=row.cwd
  const words=text.slice(m[0].length).match(/"[^"]*"|'[^']*'|\S+/g)??[]
  for(let start=0;start<Math.min(words.length,8);start++)for(let end=start+1;end<=Math.min(words.length,start+10);end++){
   const value=words.slice(start,end).join(' ').replace(/^["']|["']$/g,'')
   if(!/[\\/]lib[\\/]bin\.js$/.test(value)&&path.basename(value)!=='dsh')continue
   if(!path.isAbsolute(value)&&!cwd)cwd=await workingDirectory(row.pid)
   if(!path.isAbsolute(value)&&!cwd)continue
   const root=await addPath(path.resolve(cwd??userHome,value),node)
   if(root){cwd??=await workingDirectory(row.pid);if(cwd)await addHome(cwd)}
  }
 }
 // Desktop has a separate install registry. Never admit its profiles as npm CLI.
 if(env.DSH_HOME)await addHome(env.DSH_HOME)
 const desktopOwnedHomes=new Set(await Promise.all(desktopHomes.map(canonical)))
 const locations=[]
 const selected=desktop.get(await canonical(env.DSH_DEPOT_DESKTOP_APP??''))
 let desktopProfiles=0
 const inDesktopRuntime=selected?.supported&&process.versions.electron&&(await canonical(process.execPath))?.startsWith(selected.appPath+path.sep)
 if(inDesktopRuntime){
  for(const home of new Set(selected.layout==='bundled-cli'?[...homes]:desktopHomes)){
   const resolved=await canonical(home);if(!resolved)continue
   try{await stat(path.join(resolved,'profiles',selected.profileName,'package.json'));if(selected.layout!=='bundled-cli')await stat(path.join(resolved,'.desktop-install-state.json'))}catch{continue}
   desktopProfiles++
   locations.push({kind:'official-desktop',home:resolved,profileName:selected.profileName,dshRoot:path.join(selected.runtimeRoot,'node_modules/@deepseek-ai/dsh'),nodePath:process.execPath,desktop:selected,runtimeEnv:{ELECTRON_RUN_AS_NODE:'1'}})
  }
 }
 if(inDesktopRuntime&&selected.layout==='bundled-cli'&&!desktopProfiles)issue({code:'DESKTOP_PROFILE_NOT_INITIALIZED',message:'已找到 Desktop 自带 DSH，但未找到 '+path.join(env.DSH_HOME??path.join(userHome,'.dsh'),'profiles/desktop')+'；请先启动 Desktop 完成初始化，或在 settings.json 的 dshHome 指定实际配置主目录'})
 for(const home of homes){const resolved=await canonical(home);if(!resolved||desktopOwnedHomes.has(resolved))continue
  let profiles;try{profiles=await readdir(path.join(resolved,'profiles'))}catch{continue}
  for(const profileName of profiles.filter(p=>/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(p)&&p!=='desktop'))for(const [dshRoot,nodePath]of roots)locations.push({home:resolved,dshRoot,nodePath,profileName})
 }
 return{locations,desktop:[...desktop.values()].map(d=>({...d,homes:[...new Set(d.layout==='bundled-cli'?[...homes]:desktopHomes)]})),issues}
}
