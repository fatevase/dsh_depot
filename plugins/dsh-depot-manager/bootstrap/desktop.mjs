import {runTerminalChild} from './terminal-bridge.mjs'
import {spawn} from 'node:child_process'
import {desktopAt} from '../adapters/locate.mjs'
import {fail} from '../contracts/constants.mjs'
export async function openDesktopInstaller(desktop,{entry,args=['menu'],env=process.env,io,signal}={}){
 const verified=await desktopAt(desktop.appPath)
 if(!verified?.supported)fail('DESKTOP_CAPABILITY_UNVERIFIED','此桌面版本尚未完成安装适配')
 const launchArgs=[...(verified.layout==='bundled-cli'?['--expose-internals']:[]),entry,...args],runtimeEnv={...env,ELECTRON_RUN_AS_NODE:'1',DSH_DEPOT_DESKTOP_APP:verified.appPath}
 if(io?.isTTY)return runTerminalChild(verified.executable,launchArgs,{io,env:runtimeEnv,signal})
 return new Promise((resolve,reject)=>{
  const child=spawn(verified.executable,launchArgs,{stdio:'inherit',shell:false,env:runtimeEnv})
  child.once('error',reject);child.once('exit',code=>resolve(code??2))
 })
}
