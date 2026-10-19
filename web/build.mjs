import { supportedTarget } from '@dsh-depot/offline-format/platform'
import { mkdir, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { atomicJson, digest } from '@dsh-depot/offline-format/files'
import { isDownloadablePackage } from '@dsh-depot/offline-format/package-status'
export async function generateSite({catalog={schemaVersion:1,plugins:[],packages:[],latest:{},issues:[]},managerCatalog={schemaVersion:1,packages:[]},sourceDir=fileURLToPath(new URL('.',import.meta.url)),outDir}) {
  if(catalog.schemaVersion!==1)throw Error('Unsupported catalog schema')
  for(const p of catalog.packages)if(!supportedTarget(p.target)||!isDownloadablePackage(p)||!/^https:\/\/github\.com\//.test(p.packageUrl??''))throw Error('Catalog contains an unpublished or unlabelled download')
  const [{build},{svelte}]=await Promise.all([import('vite'),import('@sveltejs/vite-plugin-svelte')])
  await mkdir(outDir,{recursive:true})
  await build({configFile:false,root:sourceDir,base:'./',plugins:[svelte({configFile:false})],logLevel:'error',build:{outDir:path.resolve(outDir),emptyOutDir:false,rollupOptions:{input:Object.fromEntries(['index','plugins','plugin','guide','manager'].map(name=>[name,path.join(sourceDir,`${name}.html`)]))}}})
  await atomicJson(path.join(outDir,'catalog.json'),catalog)
  await atomicJson(path.join(outDir,'manager-catalog.json'),managerCatalog)
  return {files:await readdir(outDir),catalogDigest:digest(JSON.stringify(catalog))}
}

import {parseArgs} from 'node:util'
import {readFile} from 'node:fs/promises'
export async function main(args=process.argv.slice(2)){
 const {values}=parseArgs({args,options:{catalog:{type:'string'},'manager-catalog':{type:'string'},output:{type:'string'}}})
 const load=async file=>file?JSON.parse(await readFile(path.resolve(file),'utf8')):undefined
 return generateSite({catalog:await load(values.catalog),managerCatalog:await load(values['manager-catalog']),outDir:path.resolve(values.output??fileURLToPath(new URL('../.runtime/web/site',import.meta.url)))})
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().then(r=>console.log(JSON.stringify(r)),e=>{console.error(e.message);process.exitCode=1})
