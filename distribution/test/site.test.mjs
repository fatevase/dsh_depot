import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { readFile } from 'node:fs/promises'
import { generateSite } from '../lib/site.mjs'
import { selectPlugins, searchUrl } from '../web/catalog.mjs'
import { initialState } from '../lib/model.mjs'
import { temporary } from './helpers.mjs'
test('site emits a real empty catalog and escapes upstream text through data, without fake downloads',async t=>{
 const out=await temporary(t),catalog={schemaVersion:1,plugins:[{id:'evil',name:'"\n</script><img src=x onerror=alert(1)>',repository:'a/b'}],packages:[],latest:{},issues:[],lastSuccessfulDiscoveryAt:'2026-10-18'}
 await generateSite({catalog,state:initialState(),outDir:out})
 const saved=JSON.parse(await readFile(path.join(out,'catalog.json')));assert.equal(saved.packages.length,0);assert.equal(saved.plugins[0].name,catalog.plugins[0].name)
 for(const file of ['index.html','plugins.html','plugin.html','guide.html']){const html=await readFile(path.join(out,file),'utf8');assert.ok(!html.includes('<img src=x'));assert.match(html,/<script[^>]+src="\.\/assets\/[^\"]+\.js"/)}
 assert.equal(selectPlugins(saved,{verified:true}).length,0)
})
test('filters use published platform packages only and detail return preserves the query',()=>{
 const catalog={plugins:[{id:'one',name:'Alpha',category:'tools',repository:'Jane/one',description:'任务'},{id:'two',name:'Beta',category:'workspace',repository:'a/two'}],packages:[{recipeId:'one',target:'macos-arm64',status:'published',compressedBytes:10,verification:{status:'passed'}}]}
 assert.equal(selectPlugins(catalog,{q:'jane',platform:'macos-arm64',verified:true})[0].id,'one');assert.equal(selectPlugins(catalog,{platform:'linux-x64',verified:true}).length,0)
 const p=new URLSearchParams({q:'任务 & "',category:'tools',platform:'macos-arm64',verified:'1',sort:'small'});assert.equal(new URL(searchUrl(p),'https://example.test/').searchParams.get('q'),'任务 & "')
})
test('platform selection keeps curated plugin information visible until verified-only is selected',()=>{
 const catalog={plugins:[{id:'one',name:'Alpha',category:'tools',repository:'Jane/one'}],packages:[]}
 assert.equal(selectPlugins(catalog,{platform:'linux-x64'}).length,1)
 assert.equal(selectPlugins(catalog,{platform:'linux-x64',verified:true}).length,0)
})
