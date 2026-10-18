import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { writeFile } from 'node:fs/promises'
import { initialState, digest } from '../lib/model.mjs'
import { recoverPublishedReceipts } from '../lib/republication.mjs'
import { temporary } from './helpers.mjs'
test('existing verified packages are recovered by final asset URL and checksum without rebuilding',async t=>{
 const dir=await temporary(t),state=initialState(),sha=digest(Buffer.from('verified bytes')),key='a'.repeat(64),oldName=`one-1.0.0-linux-x64-${key}.tgz`
 state.latest.one=key;state.published[key]={buildKey:key,recipeId:'one',status:'published',fileName:oldName,sha256:sha,verification:{status:'passed'}}
 state.receipts[key]={buildKey:key,recipeId:'one',status:'verified',source:{version:'1.0.0'},target:'linux-x64',artifacts:{sha256:sha,package:'/expired-runner/package.tgz'},verification:{status:'passed'}}
 const good=`https://github.com/x/y/releases/download/depot-old/${oldName}`,github={list:async()=>[{draft:false,assets:[{name:oldName,digest:`sha256:${sha}`,browser_download_url:good}]}]},seen=[]
 const download=async(url,file)=>{seen.push(url);await writeFile(file,'verified bytes')}
 const recovered=await recoverPublishedReceipts({state,repository:'x/y',github,workDir:dir,recipeIds:new Set(['one']),download})
 assert.deepEqual(seen,[good]);assert.equal(recovered.receipts.length,1);assert.equal(recovered.receipts[0].artifacts.sha256,sha);assert.equal(recovered.tasks[0].buildKey,key)
 await assert.rejects(recoverPublishedReceipts({state,repository:'x/y',github,workDir:dir,recipeIds:new Set(['one']),download:async(_,file)=>writeFile(file,'corrupt')}),/checksum/i)
 state.withdrawn[key]={reason:'withdrawn'};assert.equal((await recoverPublishedReceipts({state,repository:'x/y',github,workDir:dir,recipeIds:new Set(['one']),download})).receipts.length,0)
})
