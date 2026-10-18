import test from 'node:test'
import assert from 'node:assert/strict'
import { writeFile,readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { runCommand,isolatedEnv } from '../lib/process.mjs'
import { temporary } from './helpers.mjs'
test('a host that never becomes ready fails within the configured deadline and retains logs',async t=>{
 const dir=await temporary(t),fake=path.join(dir,'fake.mjs'),input=path.join(dir,'input.json');await writeFile(fake,"console.log('starting but not ready');setInterval(()=>{},1000)")
 await writeFile(input,JSON.stringify({dshBin:fake,startupTimeoutMs:1000,probes:{clientModule:'fixture'},logFile:path.join(dir,'host.log')}))
 const result=await runCommand({argv:[process.execPath,fileURLToPath(new URL('../lib/host-probe.mjs',import.meta.url)),input],cwd:dir,env:await isolatedEnv(dir),timeoutMs:4000,logFile:path.join(dir,'result.log')})
 assert.equal(result.timedOut,false);assert.notEqual(result.exitCode,0);assert.match(result.output,/not become ready/);assert.match(await readFile(path.join(dir,'host.log'),'utf8'),/starting but not ready/)
})
