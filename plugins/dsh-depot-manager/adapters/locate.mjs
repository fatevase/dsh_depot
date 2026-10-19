// Bounded local discovery only: no recursive disk scan, shell evaluation or network.
import {readFile,realpath,readdir,stat,open} from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import {runHostCommand} from './command.mjs'
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
async function desktopManifest(resources){
 try{return await json(path.join(resources,'app/package.json'))}catch{}
 const file=await open(path.join(resources,'app.asar'),'r')
 try{
  const size=(await file.stat()).size,header=Buffer.alloc(16);if((await file.read(header,0,16,0)).bytesRead!==16)return null
  const block=header.readUInt32LE(4),length=header.readUInt32LE(12)
  if(length<2||length>16*1024*1024||block<length+8||block>length+32||block+8>size)return null
  const buffer=Buffer.alloc(length);if((await file.read(buffer,0,length,16)).bytesRead!==length)return null
  const entry=JSON.parse(buffer).files?.['package.json'],offset=Number(entry?.offset),bytes=entry?.size
  if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(bytes)||bytes<2||bytes>256*1024||block+8+offset+bytes>size||entry.link)return null
  const content=Buffer.alloc(bytes);if((await file.read(content,0,bytes,block+8+offset)).bytesRead!==bytes)return null
  return JSON.parse(content)
 }finally{await file.close()}
}
async function desktopAt(input){
 let dir=await canonical(input);if(!dir)return null
 if(!(await stat(dir)).isDirectory())dir=path.dirname(dir)
 for(let i=0;i<5;i++){
  for(const resources of [path.join(dir,'Contents/Resources'),path.join(dir,'resources'),path.basename(dir).toLowerCase()==='resources'?dir:null].filter(Boolean)){
   try{const pkg=await desktopManifest(resources);if(pkg?.name==='dsh-desktop'&&typeof pkg.version==='string')return{kind:'official-desktop',appPath:await canonical(resources.endsWith(path.join('Contents','Resources'))?path.resolve(resources,'../..'):path.dirname(resources)),version:pkg.version,dshVersion:pkg.dependencies?.['@deepseek-ai/dsh'],capabilities:{inspect:true,writeSession:false},blockedReason:'DESKTOP_CAPABILITY_UNVERIFIED'}}catch{}
  }
  const parent=path.dirname(dir);if(parent===dir)break;dir=parent
 }
 return null
}
export async function runningProcesses(){
 const windows=process.platform==='win32'
 const command=windows?{executable:'powershell.exe',args:['-NoProfile','-NonInteractive','-Command',"$ErrorActionPreference='Stop'; $env:PSModulePath=[IO.Path]::Combine($PSHOME,'Modules'); Get-CimInstance Win32_Process | Where-Object { $_.Name -match '^(node|dsh|DSH Desktop|dsh-desktop)(\\.exe)?$' } | Select-Object ProcessId,ExecutablePath,CommandLine | ConvertTo-Json -Compress"]}:{executable:'ps',args:['-u',String(process.getuid()),'-o','pid=,args=']}
 const r=await runHostCommand({...command,cwd:os.tmpdir()},{timeoutMs:10000,maxBytes:8*1024*1024})
 if(r.exitCode||r.stdout.length>=8*1024*1024)throw Object.assign(new Error('进程查找不可用；仍可使用路径查找和手动输入'),{code:'PROCESS_DISCOVERY_UNAVAILABLE'})
 return windows?[].concat(JSON.parse(r.stdout||'[]')).filter(Boolean).map(p=>({pid:p.ProcessId,executable:p.ExecutablePath,command:p.CommandLine??''})):r.stdout.split('\n').map(line=>{const m=line.trim().match(/^(\d+)\s+(.*)$/);return m?{pid:+m[1],command:m[2]}:null}).filter(Boolean)
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
 const apps=process.platform==='darwin'?['/Applications/DSH Desktop.app',path.join(userHome,'Applications/DSH Desktop.app')]:process.platform==='win32'?[path.join(env.LOCALAPPDATA??path.join(userHome,'AppData/Local'),'Programs/DSH Desktop'),path.join(env.LOCALAPPDATA??path.join(userHome,'AppData/Local'),'Programs/dsh-desktop'),path.join(env.ProgramFiles??'C:\\Program Files','DSH Desktop')]:['/opt/DSH Desktop','/opt/dsh-desktop','/usr/lib/dsh-desktop']
 for(const input of [...standardRoots,...apps,...paths].filter(Boolean))await addPath(input)
 for(const dir of (env.PATH??env.Path??'').split(path.delimiter).filter(Boolean)){
  for(const name of process.platform==='win32'?['dsh.cmd','dsh.exe','dsh-desktop.exe','DSH Desktop.exe']:['dsh','dsh-desktop'])await addPath(path.join(dir,name))
  await addPath(path.join(dir,'node_modules/@deepseek-ai/dsh'));await addPath(path.join(dir,'../lib/node_modules/@deepseek-ai/dsh'))
 }
 if(processes===undefined)try{processes=await runningProcesses()}catch(e){issue(e);processes=[]}
 let inspected=0
 for(const row of processes){
  const text=row.command??'';if(row.pid===process.pid||!/(?:dsh|lib[/\\]bin\.js)/i.test(text)||inspected++>=32)continue
  const data=text.match(/--user-data-dir(?:=|\s+)("[^"]+"|'[^']+'|.*?)(?=\s+--[a-zA-Z]|$)/);if(data){const value=data[1].replace(/^["']|["']$/g,'');const home=await canonical(path.join(value,'harness'));if(home)desktopHomes.push(home)}
  const appMatch=text.match(/^"?(.*?\.app)(?:[/\\]|\s)/i);if(appMatch){await addPath(appMatch[1]);continue}
  const desktopExe=text.match(/^"?(.+?[/\\](?:dsh-desktop|DSH Desktop)(?:\.exe)?)"?(?=\s|$)/i);if(desktopExe)await addPath(desktopExe[1])
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
 for(const home of homes){const resolved=await canonical(home);if(!resolved||desktopOwnedHomes.has(resolved))continue
  let profiles;try{profiles=await readdir(path.join(resolved,'profiles'))}catch{continue}
  for(const profileName of profiles.filter(p=>/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(p)&&p!=='desktop'))for(const [dshRoot,nodePath]of roots)locations.push({home:resolved,dshRoot,nodePath,profileName})
 }
 return{locations,desktop:[...desktop.values()].map(d=>({...d,homes:[...new Set(desktopHomes)]})),issues}
}
