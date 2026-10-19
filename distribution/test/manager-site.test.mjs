import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile,writeFile} from 'node:fs/promises'
import {createRequire} from 'node:module'
import {pathToFileURL,fileURLToPath} from 'node:url'
import {temporary} from './helpers.mjs'
import path from 'node:path'
const require=createRequire(new URL('../package.json',import.meta.url)),{compile}=require('svelte/compiler'),{render}=await import(pathToFileURL(require.resolve('svelte/server')))
test('manager downloads stay absent until a real qualified asset exists',async t=>{const source=fileURLToPath(new URL('../web/ManagerDownload.svelte',import.meta.url)),dir=await temporary(t);const {js}=compile(await readFile(source,'utf8'),{filename:source,generate:'server'});await writeFile(path.join(dir,'manager.mjs'),js.code.replace(/from (['"])([^'"]+)\1/g,(_,q,id)=>`from ${q}${pathToFileURL(require.resolve(id)).href}${q}`));const C=(await import(pathToFileURL(path.join(dir,'manager.mjs')))).default;const html=render(C,{props:{initialCatalog:{schemaVersion:1,packages:[]}}}).body;assert.match(html,/尚未提供/);assert.ok(!html.includes('releases/download'));assert.match(html,/完整包/);assert.match(html,/轻量包/);assert.match(html,/Node/);assert.ok(!html.includes('sh install.sh'));assert.match(html,/guide.html#manager/)} )
