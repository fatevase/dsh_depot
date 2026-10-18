import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { pathToFileURL, fileURLToPath } from 'node:url'
import path from 'node:path'
import { temporary } from './helpers.mjs'

// Exercise the actual Svelte components; resolve compiler output in a test-only directory.
const require=createRequire(new URL('../package.json',import.meta.url))
const {compile}=require('svelte/compiler')
const {render}=await import(pathToFileURL(require.resolve('svelte/server')))
async function app(t){
 const dir=await temporary(t)
 for(const name of ['PluginCard','App']){
  const source=fileURLToPath(new URL(`../web/${name}.svelte`,import.meta.url))
  const {js}=compile(await readFile(source,'utf8'),{filename:source,generate:'server'})
  const code=js.code.replace(/from (['"])([^'"]+)\1/g,(whole,quote,id)=>{
   const resolved=id==='./PluginCard.svelte'?path.join(dir,'PluginCard.mjs'):id==='./catalog.mjs'?fileURLToPath(new URL('../web/catalog.mjs',import.meta.url)):require.resolve(id)
   return `from ${quote}${pathToFileURL(resolved).href}${quote}`
  })
  await writeFile(path.join(dir,`${name}.mjs`),code)
 }
 return (await import(pathToFileURL(path.join(dir,'App.mjs')))).default
}
const catalog={schemaVersion:1,host:{version:'0.2.0-rc.2',node:'26.9.0'},plugins:[{id:'one',name:'<img src=x onerror=alert(1)>',repository:'curated/one',category:'workspace',seed:{version:'1.0.0',commit:'a'.repeat(40)},license:'MIT'}],packages:[{recipeId:'one',buildKey:'verified-key',target:'darwin-arm64',version:'1.0.0',status:'published',compressedBytes:250000,fileName:'one-1.0.0-darwin-arm64.tgz',sha256:'b'.repeat(64),packageUrl:'https://github.com/fatevase/dsh_depot/releases/download/batch/one.tgz',reportUrl:'https://github.com/fatevase/dsh_depot/releases/download/batch/report.json',host:{version:'0.2.0-rc.2',node:'26.9.0'},verification:{status:'passed',checks:{install:true,compose:true,host:true,clientModule:true},scope:['cold-install']}}]}
test('actual Svelte cards escape upstream markup and link back to retained search filters',async t=>{
 const component=await app(t)
 const {body}=render(component,{props:{initialCatalog:catalog,initialPage:'plugins.html',initialSearch:'?category=workspace&platform=linux-x64'}})
 assert.ok(!body.includes('<img src=x'))
 assert.match(body,/&lt;img src=x/)
 assert.match(body,/return=plugins.html%3Fcategory%3Dworkspace%26platform%3Dlinux-x64/)
 assert.match(body,/Linux · x64 · 待验证/)
})
test('detail commands, download, and passed proof belong only to the selected published platform',async t=>{
 const component=await app(t)
 const html=platform=>render(component,{props:{initialCatalog:catalog,initialPage:'plugin.html',initialSearch:`?id=one&platform=${platform}&tab=proof`}}).body
 const mac=html('darwin-arm64'),linux=html('linux-x64')
 assert.match(mac,/one-1.0.0-darwin-arm64.tgz/);assert.match(mac,/--offline --ignore-scripts/);assert.match(mac,/releases\/download\/batch\/one.tgz/);assert.match(mac,/全新缓存 · 断网安装<\/span><small[^>]*>通过/)
 assert.ok(!linux.includes('one-1.0.0-darwin-arm64.tgz'));assert.ok(!linux.includes('releases/download/batch/one.tgz'));assert.match(linux,/暂无报告/)
})
