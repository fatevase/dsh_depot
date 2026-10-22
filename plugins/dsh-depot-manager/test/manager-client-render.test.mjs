import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile,writeFile,readdir} from 'node:fs/promises'
import path from 'node:path'
import {createRequire} from 'node:module'
import {fileURLToPath,pathToFileURL} from 'node:url'
import {temporary} from './helpers.mjs'
const require=createRequire(new URL('../package.json',import.meta.url)),{compile}=require('svelte/compiler'),{render}=await import(pathToFileURL(require.resolve('svelte/server')))
async function components(t){
 const dir=await temporary(t),root=fileURLToPath(new URL('../plugin/client/',import.meta.url))
 for(const name of (await readdir(root)).filter(n=>n.endsWith('.svelte'))){const source=path.join(root,name);const {js}=compile(await readFile(source,'utf8'),{filename:source,generate:'server'});const code=js.code.replace(/from (['"])([^'"]+)\1/g,(whole,q,id)=>`from ${q}${pathToFileURL(id.endsWith('.svelte')?path.join(dir,path.basename(id,'.svelte')+'.mjs'):id.startsWith('.')?path.resolve(path.dirname(source),id):require.resolve(id)).href}${q}`);await writeFile(path.join(dir,path.basename(name,'.svelte')+'.mjs'),code)}
 return async name=>(await import(pathToFileURL(path.join(dir,name+'.mjs')))).default
}
const installed=[{name:'fixture',version:'1.0',installed:true,enabled:true,exportable:true,meta:{title:{'zh-CN':'<img src=x>'},description:'运行依赖已经准备好'}},{name:'broken-plugin',installed:true,exportable:false,exportReason:'无法读取源插件，请修复安装后重试'}]
const initialState={host:{kind:'cli-web',version:'0.2',profileName:'test',runtimeTarget:'macos-arm64'},imports:[],installed,exports:[],operations:[],selection:null,connection:'connected'}
test('main manager shows installed plugins without enablement controls, keeping import and export in their own flows',async t=>{
 const get=await components(t),html=render(await get('App'),{props:{initialState}}).body
 assert.ok(html.includes('载入插件'));assert.ok(html.includes('broken-plugin'));assert.ok(!html.includes('role="switch"'));assert.ok(html.includes('&lt;img'));assert.ok(!html.includes('<img src=x>'))
 assert.ok(!html.includes('离线插件拖放区'));assert.ok(!html.includes('下载离线包'));assert.ok(!html.includes('安装预览'))
})
test('plugin detail offers export and preserves the reason an unreadable plugin cannot be exported',async t=>{
 const get=await components(t),App=await get('App')
 const html=render(App,{props:{initialState:{...initialState,selection:'fixture'}}}).body
 assert.ok(html.includes('导出插件'));assert.ok(html.includes('配置留在原机'));assert.ok(html.includes('1.0'))
 const core=render(App,{props:{initialState:{...initialState,selection:'broken-plugin'}}}).body
 assert.ok(core.includes('无法读取源插件'));assert.ok(core.includes('disabled'))
})
