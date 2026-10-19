import {mkdir,writeFile,stat,readdir} from 'node:fs/promises'
import path from 'node:path'
import {randomUUID} from 'node:crypto'
import {atomicJson,readJson,inside} from './files.mjs'
import {withManagerLock} from './receipts.mjs'
import {reconstructUploadedMetadata} from './upload-metadata.mjs'
import {inspectArtifact} from './inspect.mjs'
import {LIMITS,fail} from '../contracts/constants.mjs'
export async function createImport({workDir,hostId,ownerId}){await mkdir(workDir,{recursive:true,mode:0o700});const importId=randomUUID(),root=path.join(workDir,importId);await mkdir(path.join(root,'payload'),{recursive:true,mode:0o700});const session={importId,hostId,ownerId,state:'uploading',bytes:0,entries:0,root};await atomicJson(path.join(root,'session.json'),session);return session}
export async function writeImportFile(id,relative,data,{workDir,hostId,ownerId}){if(!/^[a-f0-9-]{36}$/.test(id))fail('INVALID_IMPORT','导入 ID 无效');const file=path.join(workDir,id,'session.json'),s=await readJson(file);if(s.hostId!==hostId||s.ownerId!==ownerId)fail('FORBIDDEN','无权使用此导入项');if(s.state!=='uploading')fail('IMPORT_SEALED','导入已封存');const destination=inside(path.join(s.root,'payload'),relative);if(s.bytes+data.length>LIMITS.unpackedBytes||s.entries+1>LIMITS.maxEntries)fail('RESOURCE_LIMIT','上传超过限制');await mkdir(path.dirname(destination),{recursive:true,mode:0o700});await writeFile(destination,data,{flag:'wx',mode:0o600});s.bytes+=data.length;s.entries++;await atomicJson(file,s);return s}
export async function finishImport(id,{workDir,host,ownerId,trustIndex}){
 if(!/^[a-f0-9-]{36}$/.test(id))fail('INVALID_IMPORT','导入 ID 无效')
 return withManagerLock(workDir,'upload-'+id,async()=>{
  const f=path.join(workDir,id,'session.json'),s=await readJson(f)
  if(s.hostId!==host.hostId||s.ownerId!==ownerId)fail('FORBIDDEN','无权使用此导入项')
  if(s.state!=='uploading')fail('IMPORT_SEALED','导入已封存')
  if(Object.values(s.files??{}).some(x=>!x.finished))fail('UPLOAD_INCOMPLETE','文件尚未传输完成')
  s.state='sealed';await atomicJson(f,s)
  const payload=path.join(s.root,'payload'),entries=await readdir(payload,{withFileTypes:true})
  const archive=entries.length===1&&entries[0].isFile()&&entries[0].name.endsWith('.tgz')
  if(!archive)await reconstructUploadedMetadata(payload)
  const inspection=await inspectArtifact({path:archive?path.join(payload,entries[0].name):payload,host,trustIndex,workDir:path.join(s.root,'inspected')});inspection.importId=id
  await atomicJson(path.join(s.root,'inspection.json'),inspection);return inspection
 })
}
