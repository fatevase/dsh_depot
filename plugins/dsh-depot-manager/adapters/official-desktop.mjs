import path from 'node:path'
import {fail} from '../contracts/constants.mjs'
import {cliWebAdapter} from './cli-web.mjs'
import {runningProcesses} from './locate.mjs'
export async function desktopIsRunning(host,{processes}={}){
 if(!host.desktop?.appPath)fail('DESKTOP_CAPABILITY_UNVERIFIED','缺少已验证的桌面安装身份')
 const root=host.desktop.appPath+path.sep
 for(const row of processes??await runningProcesses()){
  if(row.pid===process.pid)continue
  const command=(row.command??'').replace(/^"/,'')
  if(host.desktop.layout==='bundled-cli'){
   const text=command.replaceAll('\\','/').toLowerCase(),prefix=root.replaceAll('\\','/').toLowerCase()
   if(text.startsWith(prefix)&&!text.includes('--expose-internals'))return true
   continue
  }
  if(command.startsWith(root)||/[/\\](?:DSH Desktop(?: Helper[^/\\]*)?|dsh-desktop)(?:\.exe)?(?:["'\s]|$)/i.test(command))return true
 }
 return false
}
export function officialDesktopAdapter({runningProbe=desktopIsRunning,...options}={}){
 const adapter=cliWebAdapter({...options,runningProbe})
 return {...adapter,async withWriteSession(host,fn,context){
  if(!host.desktop?.supported||!host.capabilities.writeSession)fail('DESKTOP_CAPABILITY_UNVERIFIED','此桌面版本尚未完成安装适配')
  return adapter.withWriteSession(host,fn,context)
 }}
}
