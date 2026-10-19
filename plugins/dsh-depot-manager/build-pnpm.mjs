import path from 'node:path'
import os from 'node:os'
import {createRequire} from 'node:module'
import {mkdtemp,mkdir,cp,readFile,writeFile} from 'node:fs/promises'
import * as tar from 'tar'
import {fileHash} from './core/files.mjs'
const require=createRequire(import.meta.url)
let cached
export async function buildPnpmArchive(output){
 cached??=(async()=>{
  const temp=await mkdtemp(path.join(os.tmpdir(),'depot-pnpm-tools-')),root=path.join(temp,'package'),versions=[];await mkdir(root)
  for(const major of [10,11]){
   const file=path.join(require.resolve.paths('pnpm-'+major).find(dir=>require('node:fs').existsSync(path.join(dir,'pnpm-'+major,'package.json'))),'pnpm-'+major,'package.json'),pkg=JSON.parse(await readFile(file,'utf8')),folder=String(major)
   await cp(path.dirname(file),path.join(root,folder),{recursive:true,dereference:true})
   versions.push({major,version:pkg.version,entry:folder+'/'+pkg.bin.pnpm,nodeRange:pkg.engines.node})
  }
  await writeFile(path.join(root,'index.json'),JSON.stringify({schemaVersion:1,versions}))
  const archive=path.join(temp,'package-managers.tgz');await tar.c({file:archive,gzip:true,cwd:temp,portable:true},['package'])
  return{archive,sha256:await fileHash(archive),versions}
 })()
 const tools=await cached;await cp(tools.archive,output);return{sha256:tools.sha256,versions:tools.versions}
}
