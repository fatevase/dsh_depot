import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile,writeFile} from 'node:fs/promises'
import path from 'node:path'
import {createRequire} from 'node:module'
import {fileURLToPath,pathToFileURL} from 'node:url'
import {temporary} from './helpers.mjs'
const require=createRequire(new URL('../package.json',import.meta.url)),{compile}=require('svelte/compiler'),{render}=await import(pathToFileURL(require.resolve('svelte/server')))
test('actual manager Svelte renders scoped areas, recovery text, and escapes package HTML',async t=>{
 const dir=await temporary(t)
 for(const name of ['ImportPanel','InstalledPanel','OperationsPanel','App']){const source=fileURLToPath(new URL(`../plugin/client/${name}.svelte`,import.meta.url));const {js}=compile(await readFile(source,'utf8'),{filename:source,generate:'server'});const code=js.code.replace(/from (['"])([^'"]+)\1/g,(whole,q,id)=>`from ${q}${pathToFileURL(id.endsWith('.svelte')?path.join(dir,path.basename(id,'.svelte')+'.mjs'):id.startsWith('.')?path.resolve(path.dirname(source),id):require.resolve(id)).href}${q}`);await writeFile(path.join(dir,name+'.mjs'),code)}
 const App=(await import(pathToFileURL(path.join(dir,'App.mjs')))).default
 const html=render(App,{props:{initialState:{host:{kind:'cli-web',version:'0.2',profileName:'test',runtimeTarget:'macos-arm64'},imports:[{importId:'x',packageName:'<img src=x>',warnings:[{code:'UNVERIFIED_PACKAGE'}],checks:{}}],installed:[],operations:[{operationId:'op',state:'waiting_for_host_exit'}],selection:null,connection:'connected'}}}).body
 for(const text of ['本地插件','拖入插件安装包','已安装','操作记录','选择安装包','选择文件夹','外部安装脚本'])assert.ok(html.includes(text),text)
 assert.ok(html.includes('&lt;img'));assert.ok(!html.includes('<img src=x>'));assert.ok(!html.includes('清空数据'));assert.ok(!html.includes('切换环境'))
})
