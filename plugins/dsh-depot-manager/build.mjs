import {build} from 'esbuild'
import {compile} from 'svelte/compiler'
import * as tar from 'tar'
import {readFile,writeFile,mkdtemp,mkdir,cp,rm,stat} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import path from 'node:path'
import os from 'node:os'
import {fileHash,digest,auditTree,atomicJson} from './core/files.mjs'
import {writePackageMetadata} from './core/package-metadata.mjs'
import {fail,MANAGER_NAME,MANAGER_VERSION} from './contracts/constants.mjs'
import config from '../../distribution/config.json' with {type:'json'}
const here=fileURLToPath(new URL('.',import.meta.url))
export async function buildManager({target,output}={}) {
 if(!['macos-arm64','linux-x64','win32-x64'].includes(target))fail('INVALID_TARGET','不支持的平台')
 const temp=await mkdtemp(path.join(os.tmpdir(),'depot-manager-build-')),root=path.join(temp,'package'),lib=path.join(root,'lib'),sourceDigest=digest(JSON.stringify({host:config.host,manager:await auditTree(here,{exclude:['node_modules','dist','.runtime']}),format:await auditTree(fileURLToPath(new URL('../../packages/offline-format/',import.meta.url)))}))
 try {
  await mkdir(lib,{recursive:true});await mkdir(output,{recursive:true})
  const banner={js:'import {createRequire as __createRequire} from "node:module";const require=__createRequire(import.meta.url);'}
  await build({entryPoints:[path.join(here,'plugin/host/index.mjs')],outfile:path.join(lib,'index.js'),bundle:true,platform:'node',format:'esm',target:'node22',banner,define:{__DEPOT_EXPORT_WORKER__:'"./export-worker.mjs"'}})
  await build({entryPoints:[path.join(here,'worker/export.mjs')],outfile:path.join(lib,'export-worker.mjs'),bundle:true,platform:'node',format:'esm',target:'node22',banner})
  await build({
   entryPoints:[path.join(here,'plugin/client/index.mjs')],outfile:path.join(lib,'client.js'),bundle:true,platform:'browser',format:'cjs',banner:{js:`window.__ModuleLoader__.load({id:${JSON.stringify(MANAGER_NAME)},factory:(require)=>{var module={exports:{}};var exports=module.exports;`},footer:{js:'return module.exports;}});'},minify:true,charset:'utf8',define:{'process.env.NODE_ENV':'"production"'},conditions:['browser'],external:['react'],loader:{'.css':'text'},
   plugins:[{name:'manager-svelte',setup(builder){
    builder.onLoad({filter:/\.svelte$/},async args=>{
     const {js}=compile(await readFile(args.path,'utf8'),{filename:args.path,generate:'client',css:'external'})
     return {contents:js.code,loader:'js',resolveDir:path.dirname(args.path)}
    })
   }}]
  })
  for(const file of ['package.json','cordis.patch.yml','README.md','LICENSE'])await cp(path.join(here,'plugin',file),path.join(root,file))
  await writePackageMetadata(root,{task:{target,host:{version:config.host.version,node:config.host.node},source:{digest:sourceDigest},buildKey:digest(sourceDigest+target)},recipe:{id:MANAGER_NAME,hostRange:JSON.parse(await readFile(path.join(here,'plugin/package.json'),'utf8')).engines.dsh,probes:{}}})
  const fileName=`${MANAGER_NAME}-${MANAGER_VERSION}-${target}.tgz`,file=path.join(output,fileName);await tar.c({file,gzip:true,cwd:temp,portable:true},['package'])
  return{name:MANAGER_NAME,version:MANAGER_VERSION,target,path:file,fileName,sha256:await fileHash(file),compressedBytes:(await stat(file)).size,sourceDigest}
 }finally{await rm(temp,{recursive:true,force:true})}
}
