import {createReadStream} from 'node:fs'
import {readFile,writeFile,mkdir,rename,lstat,readdir,readlink,realpath} from 'node:fs/promises'
import {createHash,randomUUID} from 'node:crypto'
import path from 'node:path'
import {fail,LIMITS} from '../contracts/constants.mjs'
export const digest=data=>createHash('sha256').update(data).digest('hex')
export async function fileHash(file){const hash=createHash('sha256');for await(const b of createReadStream(file))hash.update(b);return hash.digest('hex')}
export async function readJson(file,fallback){try{return JSON.parse(await readFile(file,'utf8'))}catch(e){if(e.code==='ENOENT'&&fallback!==undefined)return fallback;throw e}}
export async function atomicJson(file,value){await mkdir(path.dirname(file),{recursive:true,mode:0o700});const tmp=file+'.'+randomUUID()+'.tmp';await writeFile(tmp,JSON.stringify(value,null,2)+'\n',{mode:0o600,flag:'wx'});await rename(tmp,file)}
export function safeRelative(input){
 if(typeof input!=='string'||!input||input.includes('\\')||/[\x00-\x1f\x7f:]/.test(input)||path.posix.isAbsolute(input))fail('UNSAFE_PATH','归档或上传路径无效')
 const parts=input.replace(/\/$/,'').split('/');if(parts.some(p=>!p||p==='.'||p==='..'||/[. ]$/.test(p)||/^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(p)))fail('UNSAFE_PATH','路径包含保留名称或越界成分')
 if(parts.length>LIMITS.maxDepth)fail('RESOURCE_LIMIT','目录层级过深');return parts.join('/')
}
export function inside(root,relative){const p=path.resolve(root,safeRelative(relative));if(!p.startsWith(path.resolve(root)+path.sep))fail('UNSAFE_PATH','路径超出根目录');return p}
export async function auditTree(root,{exclude=[],limits={}}={}){
 const base=await realpath(root),records=[],seen=new Set();let bytes=0;const cap={...LIMITS,...limits}
 async function visit(dir,prefix='') {for(const ent of (await readdir(dir,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){const rel=safeRelative(prefix+ent.name);if(exclude.includes(rel))continue;const key=rel.toLowerCase();if(seen.has(key))fail('UNSAFE_PATH','存在大小写冲突');seen.add(key);if(seen.size>cap.maxEntries)fail('RESOURCE_LIMIT','文件条目过多');const file=path.join(dir,ent.name),s=await lstat(file);if(s.isDirectory()){records.push({path:rel,type:'directory'});await visit(file,rel+'/')}else if(s.isFile()){bytes+=s.size;if(bytes>cap.unpackedBytes)fail('RESOURCE_LIMIT','展开内容过大');records.push({path:rel,type:'file',size:s.size,sha256:await fileHash(file),mode:s.mode&0o111?0o755:0o644})}else if(s.isSymbolicLink()){const target=await readlink(file);if(path.isAbsolute(target)||target.includes('\\'))fail('UNSAFE_PATH','链接目标无效');const resolved=await realpath(file).catch(()=>null);if(!resolved||!resolved.startsWith(base+path.sep))fail('UNSAFE_PATH','链接指向包外或不存在');records.push({path:rel,type:'symlink',target})}else fail('UNSAFE_PATH','不支持的特殊文件')}}
 await visit(base);return records.sort((a,b)=>a.path.localeCompare(b.path))
}
