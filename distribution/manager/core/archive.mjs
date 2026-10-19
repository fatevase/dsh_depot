import {createReadStream} from 'node:fs'
import {mkdir,stat} from 'node:fs/promises'
import path from 'node:path'
import * as tar from 'tar'
import {safeRelative,auditTree} from './files.mjs'
import {fail,LIMITS,ManagerError} from '../contracts/constants.mjs'
export async function extractSafeArchive(file,destination,limits={}){
 const cap={...LIMITS,...limits};if((await stat(file)).size>cap.compressedBytes)fail('RESOURCE_LIMIT','压缩包过大')
 const entries=[],seen=new Set();let size=0
 await new Promise((resolve,reject)=>{
  const parser=new tar.Parser({strict:true,maxMetaEntrySize:1024*1024,maxDecompressionRatio:1000}),input=createReadStream(file)
  const error=e=>{input.destroy();reject(e instanceof ManagerError?e:new ManagerError('UNSAFE_ARCHIVE','归档损坏或不安全',{reason:e.message}))}
  parser.on('error',error);input.on('error',error);parser.on('end',resolve)
  parser.on('entry',e=>{try{
   const p=safeRelative(e.path);if(p!=='package'&&!p.startsWith('package/'))fail('UNSAFE_ARCHIVE','需要标准 npm package 根目录')
   if(seen.has(p.toLowerCase()))fail('UNSAFE_ARCHIVE','归档存在重复或大小写冲突');seen.add(p.toLowerCase())
   if(seen.size>cap.maxEntries||p.split('/').length-1>cap.maxDepth)fail('RESOURCE_LIMIT','归档条目或目录层级超限')
   if(!['File','OldFile','Directory','SymbolicLink'].includes(e.type))fail('UNSAFE_ARCHIVE','不支持的归档条目')
   size+=e.size;if(!Number.isSafeInteger(size)||size>cap.unpackedBytes)fail('RESOURCE_LIMIT','展开内容过大')
   if(e.type==='SymbolicLink'){if(path.posix.isAbsolute(e.linkpath)||e.linkpath.includes('\\'))fail('UNSAFE_ARCHIVE','链接越界');const target=path.posix.resolve('/'+path.posix.dirname(p),e.linkpath);if(!target.startsWith('/package/'))fail('UNSAFE_ARCHIVE','链接越界')}
   entries.push({path:p,type:e.type,linkpath:e.linkpath});e.resume()
  }catch(err){parser.abort(err);input.destroy();reject(err)}});input.pipe(parser)
 })
 if(!entries.length)fail('UNSAFE_ARCHIVE','空归档')
 for(const link of entries.filter(x=>x.type==='SymbolicLink'))if(entries.some(x=>x.path.startsWith(link.path+'/')))fail('UNSAFE_ARCHIVE','归档不能通过链接父目录写入')
 await mkdir(destination,{recursive:false,mode:0o700});try{await tar.x({file,cwd:destination,strip:1,strict:true,preserveOwner:false,noChmod:false});await auditTree(destination,{limits:cap})}catch(e){if(e.code)throw e;fail('UNSAFE_ARCHIVE','解包失败',{reason:e.message})}
 return destination
}
