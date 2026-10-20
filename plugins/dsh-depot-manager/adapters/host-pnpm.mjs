import path from 'node:path'
import {access} from 'node:fs/promises'
import {pathToFileURL} from 'node:url'
import {fail} from '../contracts/constants.mjs'

const exists=async file=>{try{await access(file);return true}catch{return false}}
// The installation owns both the pnpm version and its launch/recovery wrapper.
export async function desktopPackageManager(desktop,{nodePath}={}){
 const bin=path.join(desktop.runtimeRoot,'node_modules/pnpm/bin')
 let entry
 for(const name of ['pnpm.cjs','pnpm.mjs'])if(await exists(path.join(bin,name))){entry=path.join(bin,name);break}
 const runner=path.join(desktop.runtimeRoot,'node_modules/dsh-desktop-market-installer/pnpm-runner.mjs')
 const helper=path.join(desktop.resources,'packaged-pnpm-invocation.mjs')
 if(!entry||!await exists(runner)||!await exists(helper)||!await exists(path.join(desktop.resources,'harness-node-entry.mjs')))fail('HOST_PACKAGE_MANAGER_UNAVAILABLE','DSH Desktop 自带的 pnpm 调用入口不完整；请修复或更新 DSH Desktop，不会替换为其他 pnpm')
 const {buildPackagedPnpmInvocation}=await import(pathToFileURL(helper).href)
 if(typeof buildPackagedPnpmInvocation!=='function')fail('HOST_PACKAGE_MANAGER_UNAVAILABLE','DSH Desktop 未提供受支持的 pnpm 调用入口')
 const invocation=buildPackagedPnpmInvocation({DSH_DESKTOP_PNPM_ENTRY:entry,DSH_DESKTOP_PNPM_RUNNER:runner},nodePath)
 if(invocation?.command!==nodePath||invocation.args?.at(-2)!==runner||invocation.args?.at(-1)!==entry)fail('HOST_PACKAGE_MANAGER_UNAVAILABLE','无法完整复用 DSH Desktop 的 pnpm 调用包装')
 return invocation
}
export function desktopPnpmEnvironment(packageManager){
 return {...packageManager.env,DSH_DESKTOP_PNPM_ENTRY:packageManager.args.at(-1),DSH_DESKTOP_PNPM_RUNNER:packageManager.args.at(-2)}
}
