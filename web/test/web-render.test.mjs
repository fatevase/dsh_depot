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
 for(const name of ['PluginIcon','PluginCard','Guide','ManagerDownload','BuildProof','CandidateBuild','App']){
  const source=fileURLToPath(new URL(`../${name}.svelte`,import.meta.url))
  const {js}=compile(await readFile(source,'utf8'),{filename:source,generate:'server'})
  const code=js.code.replace(/from (['"])([^'"]+)\1/g,(whole,quote,id)=>{
   const resolved=id.endsWith('.svelte')?path.join(dir,path.basename(id,'.svelte')+'.mjs'):id.startsWith('.')?path.resolve(path.dirname(source),id):require.resolve(id)
   return `from ${quote}${pathToFileURL(resolved).href}${quote}`
  })
  await writeFile(path.join(dir,`${name}.mjs`),code)
 }
 return (await import(pathToFileURL(path.join(dir,'App.mjs')))).default
}
const catalog={schemaVersion:1,host:{version:'0.2.0-rc.2',node:'26.9.0'},plugins:[{id:'one',name:'<img src=x onerror=alert(1)>',repository:'curated/one',category:'workspace',seed:{version:'1.0.0',commit:'a'.repeat(40)},license:'MIT'}],packages:[{recipeId:'one',buildKey:'verified-key',target:'macos-arm64',version:'1.0.0',status:'published',compressedBytes:250000,fileName:'one-1.0.0-macos-arm64.tgz',sha256:'b'.repeat(64),packageUrl:'https://github.com/fatevase/dsh_depot/releases/download/batch/one.tgz',reportUrl:'https://github.com/fatevase/dsh_depot/releases/download/batch/report.json',host:{version:'0.2.0-rc.2',node:'26.9.0'},verification:{status:'passed',checks:{install:true,compose:true,host:true,clientModule:true},scope:['cold-install']}}]}
test('actual Svelte cards escape upstream markup and link back to retained search filters',async t=>{
 const component=await app(t)
 const {body}=render(component,{props:{initialCatalog:catalog,initialPage:'plugins.html',initialSearch:'?category=workspace&platform=linux-x64'}})
 assert.ok(!body.includes('<img src=x'))
 assert.match(body,/&lt;img src=x/)
 assert.match(body,/return=plugins.html%3Fcategory%3Dworkspace%26platform%3Dlinux-x64/)
 assert.match(body,/Linux · x64 · 尚未发布/)
})
test('detail commands, download, and passed proof belong only to the selected published platform',async t=>{
 const component=await app(t)
 const html=platform=>render(component,{props:{initialCatalog:catalog,initialPage:'plugin.html',initialSearch:`?id=one&platform=${platform}&tab=proof`}}).body
 const mac=html('macos-arm64'),linux=html('linux-x64')
 assert.match(mac,/one-1.0.0-macos-arm64.tgz/);assert.match(mac,/--offline --ignore-scripts/);assert.match(mac,/releases\/download\/batch\/one.tgz/);assert.match(mac,/空缓存离线安装<\/h3><p>[^<]+<\/p><\/div><span[^>]*dv-check-passed[^>]*>通过/)
 assert.ok(!linux.includes('one-1.0.0-macos-arm64.tgz'));assert.ok(!linux.includes('releases/download/batch/one.tgz'));assert.match(linux,/未执行／无记录/)
})
test('home counts current downloads and links to the separate guide',async t=>{
 const component=await app(t),c=structuredClone(catalog)
 c.latest={current:'verified-key'};c.packages.push({...c.packages[0],buildKey:'historical-key'})
 const {body}=render(component,{props:{initialCatalog:c}})
 assert.match(body,/当前可下载 1 个平台包/);assert.ok(!body.includes('精选'))
 assert.match(body,/href="guide.html"/);assert.ok(!body.includes('pnpm --version'));assert.ok(!body.includes('下载或安装失败时'))
 assert.match(body,/<svg[^>]+viewBox="0 0 24 24"/)
})

test('guide has its own page and renders without needing a plugin catalog',async t=>{
 const component=await app(t)
 const {body}=render(component,{props:{initialPage:'guide.html'}})
 assert.match(body,/<h1>离线安装指南<\/h1>/)
 assert.match(body,/href="guide.html" aria-current="page"/)
 assert.match(body,/pnpm --version/);assert.match(body,/sha256sum/);assert.match(body,/--profile web/)
 assert.ok(!body.includes('正在读取插件目录'));assert.ok(!body.includes('关闭安装指南'))
})
test('all-platform cards show both available systems and the current Windows verification failure',async t=>{
 const component=await app(t),c=structuredClone(catalog)
 c.packages.push({...c.packages[0],buildKey:'linux-key',target:'linux-x64',compressedBytes:100})
 c.decisions=[{recipeId:'one',target:'win32-x64',buildKey:'windows-current',action:'needs_attention'}]
 c.issues=[{recipeId:'one',target:'win32-x64',buildKey:'windows-old',status:'failed',error:{message:'Build plan inputs changed'}},{recipeId:'one',target:'win32-x64',buildKey:'windows-current',status:'unverified',error:{message:'Network isolation controls failed'}}]
 const html=render(component,{props:{initialCatalog:c,initialPage:'plugins.html'}}).body
 assert.match(html,/macOS · arm64 · 已验证 · 可下载/);assert.match(html,/Linux · x64 · 已验证 · 可下载/);assert.match(html,/Windows · x64 · 验证未通过/)
 const win=render(component,{props:{initialCatalog:c,initialPage:'plugin.html',initialSearch:'?id=one&platform=win32-x64'}}).body
 assert.match(win,/网络隔离检查未通过/);assert.ok(!win.includes('Build plan inputs changed'));assert.ok(!win.includes('href="https://github.com/fatevase/dsh_depot/releases/download/batch/one.tgz"'))
 const mac=render(component,{props:{initialCatalog:c,initialPage:'plugins.html',initialSearch:'?platform=macos-arm64'}}).body
 assert.match(mac,/macOS · arm64 · 已验证 · 可下载/);assert.ok(!mac.includes('Windows · x64 · 验证未通过'))
})

test('unverified downloads show an amber warning, honest proof, and stay outside verified-only results',async t=>{
 const component=await app(t),c=structuredClone(catalog),p={...c.packages[0],buildKey:'windows-current',target:'win32-x64',publicationChannel:'unverified',fileName:'one-1.0.0-win32-x64.tgz',packageUrl:'https://github.com/x/y/releases/download/batch/windows.tgz',verification:{status:'unverified',checks:{},error:{message:'Network isolation controls failed'}}}
 c.packages.push(p)
 const html=render(component,{props:{initialCatalog:c,initialPage:'plugin.html',initialSearch:'?id=one&platform=win32-x64'}}).body
 assert.match(html,/dv-unverified-warning/);assert.match(html,/下载未验证包/);assert.match(html,/网络隔离检查未通过/);assert.match(html,/href="https:\/\/github.com\/x\/y\/releases\/download\/batch\/windows.tgz"/)
 assert.ok(!html.includes('已通过所选平台的离线验证'))
 const windows=render(component,{props:{initialCatalog:c,initialPage:'plugins.html',initialSearch:'?platform=win32-x64'}}).body
 assert.match(windows,/<option value="size">包体积从小到大/)
 const only=render(component,{props:{initialCatalog:c,initialPage:'plugins.html',initialSearch:'?platform=win32-x64&verified=1'}}).body
 assert.match(only,/找到 <strong>0<\/strong>/)
})

test('old target URL parameters are rejected instead of silently selecting the new macOS target',async t=>{
 const component=await app(t)
 const {body}=render(component,{props:{initialCatalog:catalog,initialPage:'plugin.html',initialSearch:'?id=one&platform=darwin-arm64'}})
 assert.match(body,/目标平台不受支持/);assert.ok(!body.includes('releases/download/batch/one.tgz'))
})
