import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile,writeFile} from 'node:fs/promises'
import {createRequire} from 'node:module'
import {pathToFileURL,fileURLToPath} from 'node:url'
import {temporary} from './helpers.mjs'
import path from 'node:path'
const require=createRequire(new URL('../package.json',import.meta.url)),{compile}=require('svelte/compiler'),{render}=await import(pathToFileURL(require.resolve('svelte/server')))
test('manager downloads stay absent until a real qualified asset exists',async t=>{const source=fileURLToPath(new URL('../ManagerDownload.svelte',import.meta.url)),dir=await temporary(t);const {js}=compile(await readFile(source,'utf8'),{filename:source,generate:'server'});await writeFile(path.join(dir,'manager.mjs'),js.code.replace(/from (['"])([^'"]+)\1/g,(_,q,id)=>`from ${q}${pathToFileURL(require.resolve(id)).href}${q}`));const C=(await import(pathToFileURL(path.join(dir,'manager.mjs')))).default;const html=render(C,{props:{initialCatalog:{schemaVersion:1,packages:[]}}}).body;assert.match(html,/此平台暂未提供下载/);assert.ok(!html.includes('releases/download'));assert.match(html,/完整包/);assert.match(html,/轻量包/);assert.match(html,/Node/);assert.ok(html.includes('sh install.sh'));assert.ok(!html.includes('guide.html#manager'));assert.match(html,/桌面版/)} )
test('three platform previews offer downloads with incomplete and failed checks visible',async t=>{
 const source=fileURLToPath(new URL('../ManagerDownload.svelte',import.meta.url)),dir=await temporary(t),{js}=compile(await readFile(source,'utf8'),{filename:source,generate:'server'})
 await writeFile(path.join(dir,'preview.mjs'),js.code.replace(/from (['"])([^'"]+)\1/g,(_,q,id)=>`from ${q}${pathToFileURL(require.resolve(id)).href}${q}`))
 const C=(await import(pathToFileURL(path.join(dir,'preview.mjs')))).default
 for(const target of ['macos-arm64','linux-x64','win32-x64']){
  const prefix='https://github.com/fatevase/dsh_depot/releases/download/manager-preview-123/',fileName=`manager-${target}-full.tgz`,sha256='a'.repeat(64)
  const p={target,flavor:'full',channel:'preview',fileName,sha256,compressedBytes:1024,packageUrl:prefix+fileName,reportUrl:prefix+'manager-verification.json',checksumsUrl:prefix+'SHA256SUMS',verification:{status:'failed',bundleSha256:sha256,packageSha256:'b'.repeat(64),validationLevel:'plugin-only',missing:['script-install','network-isolation']}}
  const html=render(C,{props:{initialTarget:target,initialCatalog:{schemaVersion:1,packages:[p]}}}).body
  assert.ok(html.includes(p.packageUrl));assert.match(html,/下载测试安装包/);assert.match(html,/测试版 · 未完成完整验收/);assert.match(html,/基础验证存在失败/);assert.match(html,/脚本安装、网络隔离/);assert.ok(html.includes(p.reportUrl));assert.ok(!html.includes('>完整验收通过<'))
  assert.ok(!render(C,{props:{initialTarget:target,initialCatalog:{schemaVersion:1,packages:[{...p,channel:undefined}]}}}).body.includes(p.packageUrl))
 }
})
