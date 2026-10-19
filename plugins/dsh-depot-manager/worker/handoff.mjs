import path from 'node:path'
import {cp,mkdir,realpath} from 'node:fs/promises'
import {createJob} from './channel.mjs'
import {fileHash} from '../core/files.mjs'
import {fail} from '../contracts/constants.mjs'
export async function stageToolkit(toolkit,{storeDir,profileDir}) {
 const root=await realpath(toolkit.root),profile=await realpath(profileDir)
 const destination=path.join(storeDir,'toolkits',toolkit.version+'-'+toolkit.nodeFingerprint.slice(0,12))
 if(destination===profile||destination.startsWith(profile+path.sep))fail('TOOLKIT_LOCATION','维护工具必须存放在插件配置之外')
 await mkdir(destination,{recursive:true,mode:0o700})
 await cp(root,destination,{recursive:true,dereference:false})
 if(await fileHash(toolkit.nodePath)!==toolkit.nodeFingerprint)fail('RUNTIME_HASH_MISMATCH','工具 Node 已变化')
 return {...toolkit,root:destination}
}
export async function handoff(plan,toolkit,{storeDir,ownerId}={}) {
 const ticket=await createJob(plan,{root:storeDir,ownerId})
 // rc.2 has no verified independent worker lifetime. Persist; never promise background success.
 return {planId:plan.planId,state:'waiting_for_host_exit',code:'RESUME_FROM_SCRIPT',jobPath:ticket.jobPath,toolkitVersion:toolkit?.version}
}
