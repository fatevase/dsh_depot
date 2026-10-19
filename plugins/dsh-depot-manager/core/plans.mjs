import {randomUUID} from 'node:crypto'
import {realpath} from 'node:fs/promises'
import {LIMITS,fail} from '../contracts/constants.mjs'
import {validatePlan,validPackageName} from '../contracts/validate.mjs'
import {profileFingerprint,configurationFingerprint,configFingerprints} from './snapshots.mjs'
import {readJson} from './files.mjs'
import path from 'node:path'
export async function createOperationPlan({host,inspection,packageName,installedFingerprint,action,now=Date.now(),acceptUnverified=false,execution='dsh-cli'}){
 if(!['dsh-cli','snapshot'].includes(execution))fail('INVALID_PLAN','未知执行方式')
 if(host.capabilities?.writeSession===false)fail('HOST_READ_ONLY',host.capabilities.blockedReason==='PROFILE_OWNER_MISMATCH'?'请使用配置所属的普通用户，禁止 root 或提升权限写入':'此宿主尚未验证可写能力')
 if(!['install','replace','remove'].includes(action))fail('INVALID_ACTION','不支持的操作')
 if(action!=='remove'&&!inspection)fail('INVALID_IMPORT','需要已检查的离线包')
 if(inspection?.warnings?.length&&!acceptUnverified)fail('RISK_CONFIRMATION_REQUIRED','请先确认未验证或尚未确认的条件')
 const name=packageName??inspection?.packageName;if(!validPackageName(name))fail('INVALID_PACKAGE_NAME','包名无效')
 const profileDir=await realpath(host.profileDir),manifest=await readJson(path.join(profileDir,'package.json'))
 if(action==='remove'&&name.startsWith('@deepseek-ai/'))fail('PROTECTED_PACKAGE','不能通过此入口移除宿主内置包')
 if(action==='remove'&&!Object.hasOwn(manifest.dependencies??{},name))fail('NOT_INSTALLED','当前配置未安装此插件')
 const installed=await readJson(path.join(profileDir,'node_modules',name,'package.json'),{});const actualAction=action==='install'&&Object.hasOwn(manifest.dependencies??{},name)?'replace':action
 const plan={schemaVersion:1,execution,planId:randomUUID(),hostId:host.hostId,action:actualAction,previousVersion:installed.version??null,packageName:name,version:inspection?.version??null,importId:inspection?.importId??null,packageSha256:inspection?.sha256??null,installedFingerprint:installedFingerprint??null,hostFingerprint:host.fingerprint,expiresAt:now+LIMITS.planTtlMs,requiresExit:host.capabilities?.requiresExit!==false,beforeState:{manifest,profileDir,configFingerprints:await configFingerprints(profileDir),fingerprint:await (execution==='dsh-cli'?configurationFingerprint:profileFingerprint)(profileDir)},recoveryBytes:execution==='snapshot'?(inspection?.unpackedBytes??0):0,_inspection:inspection??null}
 return validatePlan(plan)
}
