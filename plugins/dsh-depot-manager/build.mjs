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
const here=fileURLToPath(new URL('.',import.meta.url))
export async function buildManager({target,output}={}) {
 if(!['macos-arm64','linux-x64','win32-x64'].includes(target))fail('INVALID_TARGET','不支持的平台')
 const temp=await mkdtemp(path.join(os.tmpdir(),'depot-manager-build-')),root=path.join(temp,'package'),lib=path.join(root,'lib'),sourceDigest=digest(JSON.stringify({manager:await auditTree(here,{exclude:['node_modules','dist','.runtime']}),format:await auditTree(fileURLToPath(new URL('../../packages/offline-format/',import.meta.url)))}))
 try {
  await mkdir(lib,{recursive:true});await mkdir(output,{recursive:true})
  const banner={js:'import {createRequire as __createRequire} from "node:module";const require=__createRequire(import.meta.url);'}
  await build({entryPoints:[path.join(here,'plugin/host/index.mjs')],outfile:path.join(lib,'index.js'),bundle:true,platform:'node',format:'esm',target:'node22',banner,define:{__DEPOT_EXPORT_WORKER__:'"./export-worker.mjs"'}})
  await build({entryPoints:[path.join(here,'worker/export.mjs')],outfile:path.join(lib,'export-worker.mjs'),bundle:true,platform:'node',format:'esm',target:'node22',banner})
  const entry=path.join(temp,'client-entry.mjs');await writeFile(entry,`import {mountManager} from ${JSON.stringify(path.join(here,'plugin/client/client.mjs'))};mountManager(document.getElementById('manager'));`)
  await build({
   entryPoints:[entry],outfile:path.join(lib,'client.js'),bundle:true,platform:'browser',format:'esm',minify:true,charset:'utf8',define:{'process.env.NODE_ENV':'"production"'},conditions:['browser'],
   plugins:[{name:'manager-svelte',setup(builder){
    builder.onLoad({filter:/\.svelte$/},async args=>{
     const {js}=compile(await readFile(args.path,'utf8'),{filename:args.path,generate:'client',css:'external'})
     return {contents:js.code,loader:'js',resolveDir:path.dirname(args.path)}
    })
   }}]
  })
  await cp(path.join(here,'plugin/client/styles.css'),path.join(lib,'client.css'))
  await writeFile(path.join(lib,'manager.html'),'<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>离线插件 · DSH</title><link rel="stylesheet" href="/api/depot/client.css"></head><body><div id="manager"></div><script type="module" src="/api/depot/client.js"></script></body></html>')
  for(const file of ['package.json','cordis.patch.yml','README.md','LICENSE'])await cp(path.join(here,'plugin',file),path.join(root,file))
  await writePackageMetadata(root,{task:{target,host:{version:'0.2.0-rc.2',node:'26.9.0'},source:{digest:sourceDigest},buildKey:digest(sourceDigest+target)},recipe:{id:MANAGER_NAME,hostRange:'0.2.0-rc.2',probes:{}}})
  const fileName=`${MANAGER_NAME}-${MANAGER_VERSION}-${target}.tgz`,file=path.join(output,fileName);await tar.c({file,gzip:true,cwd:temp,portable:true},['package'])
  return{name:MANAGER_NAME,version:MANAGER_VERSION,target,path:file,fileName,sha256:await fileHash(file),compressedBytes:(await stat(file)).size,sourceDigest}
 }finally{await rm(temp,{recursive:true,force:true})}
}
