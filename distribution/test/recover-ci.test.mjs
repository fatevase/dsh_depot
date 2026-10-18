import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { temporary } from './helpers.mjs'
import { initialState, digest } from '../lib/model.mjs'
import { recoverUnverifiedReceipts, extractCiPackage } from '../lib/recover-ci.mjs'
test('only matching completed builds from the default-branch distribution workflow can be recovered',async t=>{
 const dir=await temporary(t),state=initialState(),key='a'.repeat(64),sha=digest(Buffer.from('built bytes'))
 const receipt={buildKey:key,recipeId:'one',recipeDigest:'recipe',source:{version:'1.0.0'},host:{version:'0.2.0'},target:'win32-x64',plannedAt:'2026-10-19',stage:'verify',status:'unverified',artifacts:{sha256:sha,compressedBytes:11,unpackedBytes:20},verification:{schemaVersion:1,buildKey:key,target:'win32-x64',host:{version:'0.2.0'},sha256:sha,status:'unverified',error:{message:'Network isolation controls failed'}}}
 state.receipts[key]=receipt
 let expired=false,branch='main',event='push',corrupt=false
 const artifact=()=>({id:10,name:`distribution-result-${key}`,expired,created_at:'2026-10-19',workflow_run:{id:20,head_repository_id:1,head_branch:branch,head_sha:'commit'}})
 const github={request:async url=>({data:url.includes('/actions/artifacts?')?{artifacts:[artifact()]}:url.includes('/actions/runs/')?{path:'.github/workflows/plugin-distribution.yml',event,head_sha:'commit'}:{id:1,default_branch:'main'}}),download:async()=>{}}
 const args={state,decisions:[{buildKey:key}],recipes:[],repository:'x/y',github,workDir:dir,extract:async()=>{const file=path.join(dir,'one.tgz');await writeFile(file,corrupt?'corrupt':'built bytes');return {...structuredClone(receipt),artifacts:{...receipt.artifacts,package:file}}}}
 assert.equal((await recoverUnverifiedReceipts(args)).receipts.length,1)
 corrupt=true;await assert.rejects(recoverUnverifiedReceipts(args),/checksum/);corrupt=false
 event='pull_request';await assert.rejects(recoverUnverifiedReceipts(args),/workflow/);event='push'
 branch='feature';assert.equal((await recoverUnverifiedReceipts(args)).receipts.length,0);branch='main'
 expired=true;assert.equal((await recoverUnverifiedReceipts(args)).unavailable.length,1);expired=false
 state.withdrawn[key]={reason:'withdrawn'};assert.equal((await recoverUnverifiedReceipts(args)).receipts.length,0)
})
test('CI ZIP extraction rejects escaping paths and symlinks, and reads only the declared package',async t=>{
 const dir=await temporary(t),zip=path.join(dir,'artifact.zip')
 const make=(name,symlink=false)=>execFileSync('python3',['-c',`import zipfile,json,sys
with zipfile.ZipFile(sys.argv[1],'w') as z:
 z.writestr('receipt.json',json.dumps({'artifacts':{'package':sys.argv[2]}}))
 info=zipfile.ZipInfo(sys.argv[2]);info.external_attr=(0o120777 if sys.argv[3]=='1' else 0o100644)<<16
 z.writestr(info,b'package')
`,zip,name,symlink?'1':'0'])
 make('assets/pkg.tgz');const r=await extractCiPackage(zip,path.join(dir,'good'));assert.match(r.artifacts.package,/assets\/pkg.tgz$/)
 make('../escape.tgz');await assert.rejects(extractCiPackage(zip,path.join(dir,'bad')))
 make('assets/pkg.tgz',true);await assert.rejects(extractCiPackage(zip,path.join(dir,'link')))
})
