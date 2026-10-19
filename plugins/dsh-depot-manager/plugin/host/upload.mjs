import path from 'node:path'
import {mkdir,open,rm} from 'node:fs/promises'
import {readJson,atomicJson,inside} from '../../core/files.mjs'
import {withManagerLock,checkedId} from '../../core/receipts.mjs'
import {LIMITS,fail} from '../../contracts/constants.mjs'
export async function uploadChunk({importId,relative,offset,final,bytes},{workDir,hostId,ownerId}) {
 if(!Number.isSafeInteger(offset)||offset<0||bytes.length>262144)fail('UPLOAD_LIMIT','上传分块最多 256 KiB')
 return withManagerLock(workDir,'upload-'+checkedId(importId),async()=>{
  const file=path.join(workDir,importId,'session.json'),s=await readJson(file)
  if(s.hostId!==hostId||s.ownerId!==ownerId)fail('FORBIDDEN','无权访问导入项')
  if(s.state!=='uploading')fail('IMPORT_SEALED','已封存导入项')
  const target=inside(path.join(s.root,'payload'),relative);s.files??={};const entry=s.files[relative]
  if((entry?.bytes??0)!==offset||entry?.finished)fail('UPLOAD_OFFSET','上传顺序不符')
  if(s.bytes+bytes.length>LIMITS.unpackedBytes||(!entry&&s.entries>=LIMITS.maxEntries))fail('RESOURCE_LIMIT','上传超过限制')
  await mkdir(path.dirname(target),{recursive:true,mode:0o700})
  const handle=await open(target,offset===0?'wx':'r+',0o600)
  try{await handle.write(bytes,0,bytes.length,offset)}finally{await handle.close()}
  if(!entry)s.entries++
  s.files[relative]={bytes:offset+bytes.length,finished:!!final};s.bytes+=bytes.length;await atomicJson(file,s)
  return {bytes:s.bytes,received:offset+bytes.length,finished:!!final}
 })
}
