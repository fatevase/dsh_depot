import {spawn} from 'node:child_process'
import {desktopAt} from '../adapters/locate.mjs'
import {fail} from '../contracts/constants.mjs'
export async function openDesktopInstaller(desktop,{entry,env=process.env}={}){
 const verified=await desktopAt(desktop.appPath)
 if(!verified?.supported)fail('DESKTOP_CAPABILITY_UNVERIFIED','此桌面版本尚未完成安装适配')
 return new Promise((resolve,reject)=>{
  const child=spawn(verified.executable,[entry,'menu'],{stdio:'inherit',shell:false,env:{...env,ELECTRON_RUN_AS_NODE:'1',DSH_DEPOT_DESKTOP_APP:verified.appPath}})
  child.once('error',reject);child.once('exit',code=>resolve(code??2))
 })
}
