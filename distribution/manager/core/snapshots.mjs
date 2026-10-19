import {readdir,lstat,readlink,cp,mkdir,statfs,realpath,rm,rename,readFile,symlink} from 'node:fs/promises'
import path from 'node:path'
import {randomUUID} from 'node:crypto'
import {fileHash,digest,atomicJson,readJson} from './files.mjs'
import {fail} from '../contracts/constants.mjs'
export const PROFILE_FILES=['package.json','pnpm-lock.yaml','pnpm-workspace.yaml','cordis.yml','node_modules']
async function records(root){const list=[];async function scan(relative){const file=path.join(root,relative);let s;try{s=await lstat(file)}catch(e){if(e.code==='ENOENT')return;throw e}if(s.isSymbolicLink()){const resolved=await realpath(file).catch(()=>null);if(!resolved||!resolved.startsWith(path.resolve(root)+path.sep))fail('EXTERNAL_DEPENDENCY_LINK','依赖链接指向配置之外，无法建立独立恢复点');list.push({path:relative,type:'link',target:path.relative(root,resolved)});return}if(s.isDirectory()){list.push({path:relative,type:'directory'});for(const n of(await readdir(file)).sort())await scan(path.join(relative,n));return}if(!s.isFile())fail('SNAPSHOT_UNSUPPORTED','配置依赖图存在特殊文件');list.push({path:relative,type:'file',sha256:await fileHash(file),size:s.size,mode:s.mode&0o777})}for(const name of PROFILE_FILES)await scan(name);return list}
async function copyGraph(source,destination){
 const index=await records(source)
 for(const name of PROFILE_FILES){try{await lstat(path.join(source,name))}catch(e){if(e.code==='ENOENT')continue;throw e}await cp(path.join(source,name),path.join(destination,name),{recursive:true,dereference:false,verbatimSymlinks:true,preserveTimestamps:true})}
 for(const row of index.filter(r=>r.type==='link')){const file=path.join(destination,row.path);await rm(file);await symlink(path.relative(path.dirname(file),path.join(destination,row.target)),file,process.platform==='win32'?'junction':undefined)}
}
export async function configFingerprints(root){const result={};for(const name of ['cordis.yml','pnpm-workspace.yaml'])result[name]=await fileHash(path.join(root,name)).catch(e=>{if(e.code==='ENOENT')return null;throw e});return result}
export const profileRecords=records
export const profileFingerprint=async root=>digest(JSON.stringify(await records(root)))
export async function snapshotProfile(host,{snapshotDir,newBytes=0}={}){
 const profile=await realpath(host.profileDir);for(const name of PROFILE_FILES){const s=await lstat(path.join(profile,name)).catch(e=>{if(e.code==='ENOENT')return null;throw e});if(s?.isSymbolicLink())fail('UNSAFE_PROFILE','受管理配置文件或依赖根目录不能是链接')}
 const index=await records(profile),bytes=index.reduce((n,r)=>n+(r.size??0),0),space=await statfs(profile)
 if(space.bavail*space.bsize<bytes*2+newBytes+16*1024*1024)fail('DISK_SPACE','空间不足以保存独立备份及恢复副本')
 const snapshotId=randomUUID(),root=path.join(snapshotDir,snapshotId),payload=path.join(root,'payload');await mkdir(payload,{recursive:true,mode:0o700})
 await copyGraph(profile,payload)
 const fingerprint=digest(JSON.stringify(index));if(await profileFingerprint(profile)!==fingerprint||await profileFingerprint(payload)!==fingerprint)fail('SNAPSHOT_CHANGED','备份期间配置发生变化')
 const snapshot={schemaVersion:1,snapshotId,hostId:host.hostId,profileDir:profile,root,payload,fingerprint,bytes,files:PROFILE_FILES,createdAt:Date.now()};await atomicJson(path.join(root,'snapshot.json'),snapshot);return snapshot
}
export async function restoreProfile(snapshot,{profileDir,expectedCurrentFingerprint}={}){
 const profile=await realpath(profileDir);if(profile!==snapshot.profileDir)fail('RECOVERY_HOST_MISMATCH','恢复目标不一致')
 if(await profileFingerprint(snapshot.payload)!==snapshot.fingerprint)fail('SNAPSHOT_CORRUPT','恢复快照不完整')
 if(!expectedCurrentFingerprint||await profileFingerprint(profile)!==expectedCurrentFingerprint)fail('RECOVERY_CONFLICT','当前配置已改变，拒绝覆盖')
 const prepared=path.join(profile,'.depot-restore-'+randomUUID());await mkdir(prepared,{mode:0o700})
 try{await copyGraph(snapshot.payload,prepared)
  if(await profileFingerprint(profile)!==expectedCurrentFingerprint)fail('RECOVERY_CONFLICT','准备恢复时配置已改变')
  for(const name of PROFILE_FILES){await rm(path.join(profile,name),{recursive:true,force:true});try{await rename(path.join(prepared,name),path.join(profile,name))}catch(e){if(e.code!=='ENOENT')throw e}}
  if(await profileFingerprint(profile)!==snapshot.fingerprint)fail('RECOVERY_INCOMPLETE','恢复后依赖图未通过核对')
 }finally{await rm(prepared,{recursive:true,force:true})}
 return {restored:true,fingerprint:snapshot.fingerprint}
}
export function unrelatedManifestChanged(before,after,packageName){
 const neutral=value=>{const p=structuredClone(value);for(const field of ['dependencies','optionalDependencies','devDependencies']){if(p[field]){delete p[field][packageName];if(!Object.keys(p[field]).length)delete p[field]}}if(p.dsh?.profile?.bundles)p.dsh.profile.bundles=p.dsh.profile.bundles.filter(b=>b!==packageName&&b?.name!==packageName);return p}
 return JSON.stringify(neutral(before))!==JSON.stringify(neutral(after))
}
