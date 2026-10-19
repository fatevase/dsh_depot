import { supportedTarget } from './platform.mjs'
import { mkdir, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { atomicJson, jsonDigest } from './model.mjs'
import { catalogOf } from './publish.mjs'
import { isDownloadablePackage } from './package-status.mjs'
export async function generateSite({ catalog, managerCatalog={schemaVersion:1,packages:[]}, state, recipes = [], sourceDir = fileURLToPath(new URL('../web/',import.meta.url)), outDir }) {
  catalog ??= catalogOf(state,recipes)
  if(catalog.schemaVersion!==1)throw Error('Unsupported catalog schema')
  for(const p of catalog.packages)if(!supportedTarget(p.target)||!isDownloadablePackage(p)||!/^https:\/\/github\.com\//.test(p.packageUrl??''))throw Error('Catalog contains an unpublished or unlabelled download')
  const [{build},{svelte}]=await Promise.all([import('vite'),import('@sveltejs/vite-plugin-svelte')])
  await mkdir(outDir,{recursive:true})
  await build({configFile:false,root:sourceDir,base:'./',plugins:[svelte({configFile:false})],logLevel:'error',build:{outDir:path.resolve(outDir),emptyOutDir:false,rollupOptions:{input:Object.fromEntries(['index','plugins','plugin','guide','manager'].map(name=>[name,path.join(sourceDir,`${name}.html`)]))}}})
  await atomicJson(path.join(outDir,'catalog.json'),catalog)
  await atomicJson(path.join(outDir,'manager-catalog.json'),managerCatalog)
  return {files:await readdir(outDir),catalogDigest:jsonDigest(catalog)}
}
