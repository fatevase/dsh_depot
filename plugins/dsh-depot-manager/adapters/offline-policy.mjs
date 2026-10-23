import path from 'node:path'
import {readFile} from 'node:fs/promises'
import {isDeepStrictEqual} from 'node:util'
import {parse,parseAllDocuments} from 'yaml'

async function optional(file){
 try{return await readFile(file,'utf8')}catch(e){if(e.code==='ENOENT')return null;throw e}
}
function documents(text){
 if(text===null)return null
 try{
  const docs=parseAllDocuments(text)
  if(!docs.length||docs.some(d=>d.errors.length))return null
  return docs.map(d=>d.toJS({maxAliasCount:100}))
 }catch{return null}
}
// pnpm 11/12 re-check registry metadata even for already installed lockfile
// entries. In an offline operation, trust only the unchanged installed snapshot.
// This reads two lockfiles and the modules marker, never the dependency tree.
// It does not turn off tarball integrity, fetch new dependencies, or persist config.
export async function offlineLockfileArgs(profileDir){
 const wanted=documents(await optional(path.join(profileDir,'pnpm-lock.yaml')))
 if(!wanted?.[0]?.lockfileVersion)return []
 const modulesDir=path.join(profileDir,'node_modules')
 let virtualStoreDir='.pnpm'
 const marker=await optional(path.join(modulesDir,'.modules.yaml'))
 if(marker!==null){
  try{virtualStoreDir=parse(marker)?.virtualStoreDir??virtualStoreDir}catch{return []}
 }
 if(typeof virtualStoreDir!=='string'||!virtualStoreDir||virtualStoreDir.includes('\0'))return []
 const installed=documents(await optional(path.resolve(modulesDir,virtualStoreDir,'lock.yaml')))
 return installed&&isDeepStrictEqual(wanted,installed)?['--config.trust-lockfile=true']:[]
}
