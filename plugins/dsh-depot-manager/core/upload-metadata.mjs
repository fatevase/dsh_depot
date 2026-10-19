import path from 'node:path'
import {stat,lstat,mkdir,chmod,symlink,rm} from 'node:fs/promises'
import {readJson,fileHash,inside,safeRelative} from './files.mjs'
import {fail,LIMITS} from '../contracts/constants.mjs'
export async function reconstructUploadedMetadata(root){
 const manifest=await readJson(path.join(root,'depot-manifest.json'),null);if(!manifest)return
 const indexFile=path.join(root,'depot-files.json'),size=(await stat(indexFile)).size
 if(size>64*1024*1024||await fileHash(indexFile)!==manifest.filesSha256)fail('INTEGRITY_MISMATCH','上传的清单摘要不符')
 const index=await readJson(indexFile)
 if(!Array.isArray(index)||index.length>LIMITS.maxEntries)fail('RESOURCE_LIMIT','上传清单条目过多')
 const seen=new Set()
 for(const row of index){const rel=safeRelative(row.path),key=rel.toLowerCase();if(seen.has(key)||['depot-manifest.json','depot-files.json'].includes(rel))fail('UNSAFE_PATH','清单重名或自引用');seen.add(key)
  const file=inside(root,rel)
  if(row.type==='directory'){await mkdir(file,{recursive:true,mode:0o755});continue}
  if(row.type==='symlink')continue
  if(row.type!=='file'||![0o644,0o755].includes(row.mode)||!Number.isSafeInteger(row.size)||row.size<0)fail('INVALID_FILE_INDEX','上传文件清单无效')
  if((await stat(file)).size!==row.size||await fileHash(file)!==row.sha256)fail('INTEGRITY_MISMATCH','上传文件与清单不符')
  await chmod(file,row.mode)
 }
 for(const row of index.filter(x=>x.type==='symlink')){
  const file=inside(root,row.path)
  if(typeof row.target!=='string'||path.isAbsolute(row.target)||row.target.includes('\\'))fail('UNSAFE_PATH','链接目标无效')
  const target=path.resolve(path.dirname(file),row.target)
  if(!target.startsWith(path.resolve(root)+path.sep))fail('UNSAFE_PATH','链接超出导入目录')
  const current=await lstat(file).catch(e=>{if(e.code==='ENOENT')return null;throw e})
  if(current){if(!current.isFile())fail('DIRECTORY_LINK_UPLOAD_UNSUPPORTED','文件夹链接请使用 .tgz 导入');if(await fileHash(file)!==await fileHash(target))fail('INTEGRITY_MISMATCH','浏览器展开的链接内容不符');await rm(file)}
  await mkdir(path.dirname(file),{recursive:true});await symlink(row.target,file)
 }
 // Full tree/closure auditing runs immediately afterwards; nothing from the package executes.
}
