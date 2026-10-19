import path from 'node:path'
import {mkdir,writeFile,rm,readdir,readFile} from 'node:fs/promises'
import os from 'node:os'
import {randomUUID} from 'node:crypto'
import {atomicJson,readJson,digest} from './files.mjs'
import {fail} from '../contracts/constants.mjs'
export function checkedId(id){if(typeof id!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(id))fail('INVALID_IDENTITY','记录 ID 无效');return id}
export const operationFile=(storeDir,id)=>path.join(storeDir,'operations',checkedId(id)+'.json')
export const readOperation=(id,{storeDir})=>readJson(operationFile(storeDir,id))
export const saveOperation=(op,{storeDir})=>atomicJson(operationFile(storeDir,op.operationId),op)
async function reclaimExited(file){
 let original,record;try{original=await readFile(file,'utf8');record=JSON.parse(original)}catch{return false}
 const exited=()=>{if(record.hostname!==os.hostname()||!Number.isInteger(record.pid)||record.pid<=0)return false;try{process.kill(record.pid,0);return false}catch(e){return e.code==='ESRCH'}}
 if(!exited())return false;const claim=file+'.takeover-'+digest(original).slice(0,16)
 try{await writeFile(claim,String(process.pid),{flag:'wx',mode:0o600})}catch{return false}
 try{if(await readFile(file,'utf8')!==original||!exited())return false;await rm(file);return true}finally{await rm(claim,{force:true})}
}
export async function withManagerLock(storeDir,hostId,fn){const root=path.join(storeDir,'locks');await mkdir(root,{recursive:true,mode:0o700});const file=path.join(root,checkedId(hostId)+'.lock');for(;;){try{await writeFile(file,JSON.stringify({pid:process.pid,hostname:os.hostname(),createdAt:Date.now()}),{flag:'wx',mode:0o600});break}catch(e){if(e.code==='EEXIST'){if(await reclaimExited(file))continue;fail('OPERATION_BUSY','此配置已有任务或待检查的异常锁')}throw e}}try{return await fn()}finally{await rm(file,{force:true})}}
export async function operationsIn(storeDir){let files;try{files=await readdir(path.join(storeDir,'operations'))}catch(e){if(e.code==='ENOENT')return[];throw e}return Promise.all(files.filter(f=>f.endsWith('.json')).map(f=>readJson(path.join(storeDir,'operations',f))))}
