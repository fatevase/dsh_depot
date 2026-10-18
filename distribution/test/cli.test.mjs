import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { execFileSync, spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { temporary, recipe, source } from './helpers.mjs'
test('CLI writes a reusable plan without downloading or building a plugin',async t=>{
 const dir=await temporary(t);await mkdir(path.join(dir,'recipes'))
 await writeFile(path.join(dir,'recipes/fixture.json'),JSON.stringify(recipe()))
 await writeFile(path.join(dir,'discovered.json'),JSON.stringify({schemaVersion:1,sources:[source()]}))
 execFileSync(process.execPath,[fileURLToPath(new URL('../cli.mjs',import.meta.url)),'plan','--recipes',path.join(dir,'recipes'),'--discovered',path.join(dir,'discovered.json'),'--output',path.join(dir,'plan.json')])
 const {readFile}=await import('node:fs/promises');const plan=JSON.parse(await readFile(path.join(dir,'plan.json')))
 assert.equal(plan.tasks.length,3);assert.equal(plan.schemaVersion,1)
})
test('default site command creates a site directory under the selected work root',async t=>{
 const dir=await temporary(t)
 execFileSync(process.execPath,[fileURLToPath(new URL('../cli.mjs',import.meta.url)),'site','--work',dir])
 const {readFile}=await import('node:fs/promises');assert.match(await readFile(path.join(dir,'site/index.html'),'utf8'),/DSH Depot/)
})
test('CLI refuses an alternate publication destination before inspecting receipts or making requests',async t=>{
 const dir=await temporary(t),config=path.join(dir,'config.json')
 await writeFile(config,JSON.stringify({host:{version:'0.2.0-rc.2',node:'26.9.0'},distributionRepository:'curated/depot'}))
 const result=spawnSync(process.execPath,[fileURLToPath(new URL('../cli.mjs',import.meta.url)),'publish','--config',config,'--repository','other/repo','--receipts',path.join(dir,'absent')],{encoding:'utf8'})
 assert.equal(result.status,1)
 assert.match(result.stderr,/Distribution repository mismatch/)
})
test('remote commands require the configured destination rather than accepting a CLI-only destination',async t=>{
 const dir=await temporary(t),config=path.join(dir,'config.json')
 await writeFile(config,JSON.stringify({host:{version:'0.2.0-rc.2',node:'26.9.0'}}))
 const result=spawnSync(process.execPath,[fileURLToPath(new URL('../cli.mjs',import.meta.url)),'state-read','--config',config,'--repository','other/repo'],{encoding:'utf8'})
 assert.equal(result.status,1);assert.match(result.stderr,/Set distributionRepository/)
})
test('CI rejects running the distribution pipeline in a different repository',()=>{
 const result=spawnSync(process.execPath,[fileURLToPath(new URL('../ci.mjs',import.meta.url)),'discover'],{cwd:fileURLToPath(new URL('../../',import.meta.url)),env:{...process.env,GITHUB_REPOSITORY:'other/fork'},encoding:'utf8'})
 assert.equal(result.status,1);assert.match(result.stderr,/Distribution workflow must run in fatevase\/dsh_depot/)
})
test('direct CLI remote entrypoints also reject a fork before any GitHub request',()=>{
 const script=`globalThis.fetch=async()=>{throw Error('Remote call reached')};const {main}=await import(${JSON.stringify(new URL('../cli.mjs',import.meta.url).href)});await main(['state-read'])`
 const result=spawnSync(process.execPath,['--input-type=module','-e',script],{env:{...process.env,GITHUB_REPOSITORY:'untrusted/fork'},encoding:'utf8'})
 assert.equal(result.status,1);assert.match(result.stderr,/Distribution workflow must run in fatevase\/dsh_depot/);assert.ok(!result.stderr.includes('Remote call reached'))
})
