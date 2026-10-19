import {isAbsolute} from 'node:path'
import {runtimeTarget,supportedTarget} from '../../lib/platform.mjs'
import {LIMITS,fail} from './constants.mjs'
const schema=value=>{if(value?.schemaVersion!==1)fail('UNSUPPORTED_SCHEMA','不支持的协议版本')}
const identity=(value,name)=>{if(typeof value!=='string'||!value.trim())fail('INVALID_IDENTITY',`缺少 ${name}`)}
export function validateHost(value){
 schema(value);identity(value.hostId,'hostId');identity(value.profileName,'profileName');identity(value.profileDir,'profileDir')
 if(!isAbsolute(value.profileDir))fail('INVALID_PROFILE','配置目录必须为绝对路径')
 if(value.runtime?.source!=='host')fail('HOST_RUNTIME_REQUIRED','需要实际 DSH 宿主的运行时信息')
 const target=runtimeTarget(value.runtime.platform,value.runtime.arch)
 if(!supportedTarget(target))fail('UNSUPPORTED_TARGET','宿主平台不受支持')
 if(!['cli-web','official-desktop'].includes(value.kind))fail('UNSUPPORTED_HOST','尚未适配此宿主类型')
 identity(value.version,'version');identity(value.runtime.node,'host Node');identity(value.ownerId,'ownerId');identity(value.fingerprint,'fingerprint')
 return {...value,target}
}
export function validatePlan(value){
 schema(value)
 if(!['install','replace','remove'].includes(value.action))fail('INVALID_ACTION','不支持的插件操作')
 for(const k of ['planId','hostId','packageName','hostFingerprint'])identity(value[k],k)
 if(!Number.isFinite(value.expiresAt))fail('INVALID_PLAN','计划缺少过期时间')
 if(value.action==='remove')identity(value.installedFingerprint,'installedFingerprint')
 else {identity(value.importId,'importId');if(!/^[a-f0-9]{64}$/.test(value.packageSha256??''))fail('INVALID_PLAN','包摘要无效')}
 return value
}
export function validateResourceUsage(value){
 for(const [key,limit] of Object.entries({compressedBytes:LIMITS.compressedBytes,unpackedBytes:LIMITS.unpackedBytes,entries:LIMITS.maxEntries,depth:LIMITS.maxDepth,items:LIMITS.maxItems})){
  if(value[key]!==undefined&&(!Number.isSafeInteger(value[key])||value[key]<0||value[key]>limit))fail('RESOURCE_LIMIT',`超过资源限制：${key}`,{key,limit})
 }
 return value
}
export function validPackageName(name){return typeof name==='string'&&name.length<=214&&/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(name)&&!['node_modules','favicon.ico'].includes(name)}
