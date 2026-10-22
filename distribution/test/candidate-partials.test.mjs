import test from 'node:test'
import assert from 'node:assert/strict'
import {candidateSnapshot,mergeCandidateSnapshots} from '../candidate-catalog.mjs'
import {candidatePublicDownloads} from '../candidate-public-catalog.mjs'
const targets=['macos-arm64','linux-x64','win32-x64']
const config={id:'test',batchSize:1,entries:[1,2].map(repositoryId=>({repositoryId,repository:`owner/p${repositoryId}`}))}
const reportFor=(id,commit)=>({schemaVersion:1,campaign:'test',verification:'not-run',counts:{compiled:0,failed:0,missing:3},plugins:[{...config.entries[id-1],commit,results:Object.fromEntries(targets.map(t=>[t,{status:'missing'}]))}]})
const make=(id,runId)=>candidateSnapshot(reportFor(id,'a'.repeat(40)),{config,run:{id:runId,run_attempt:1,updated_at:'2026-10-22'},repository:'fatevase/dsh_depot',artifacts:[],partial:true})
test('partial candidate reports retain other repositories and per-run source identity',()=>{
 const first=mergeCandidateSnapshots(null,make(1,10),config)
 assert.equal(first.plugins.length,2);assert.equal(first.plugins[0].runId,10)
 const next=mergeCandidateSnapshots(first,make(2,11),config)
 assert.equal(next.plugins[0].runId,10);assert.equal(next.plugins[1].runId,11)
 assert.equal(next.runId,11);assert.equal(next.counts.missing,6)
})
test('downloads lookup follows each plugin build run rather than overwriting all with the latest partial run',async()=>{
 const snapshot=mergeCandidateSnapshots(mergeCandidateSnapshots(null,make(1,10),config),make(2,11),config),seen=[]
 const github={request:async endpoint=>{seen.push(endpoint);const error=Error('No release');error.status=404;throw error}}
 const result=await candidatePublicDownloads({github,snapshot})
 assert.equal(result.plugins.length,2)
 assert.ok(seen.some(s=>s.endsWith('/candidate-10-1')));assert.ok(seen.some(s=>s.endsWith('/candidate-11-1')))
})

test('an older run manifest may contain packages already superseded by another partial run',async()=>{
 const sha='b'.repeat(64),commit='a'.repeat(40),file={filename:'p-1.0.0.tgz',version:'1.0.0',sha256:sha,bytes:10}
 const snapshot={schemaVersion:1,runId:11,runAttempt:1,plugins:[1,2].map((repositoryId,index)=>({repositoryId,repository:`owner/p${repositoryId}`,commit,runId:10+index,runAttempt:1,results:{'linux-x64':{status:'compiled',files:[file]}}}))}
 const github={request:async endpoint=>{const runId=Number(endpoint.match(/candidate-(\d+)-1$/)[1]),tag=`candidate-${runId}-1`;return{data:{draft:false,prerelease:true,tag_name:tag,assets:[{name:'candidate-downloads.json',size:10,browser_download_url:`https://github.com/fatevase/dsh_depot/releases/download/${tag}/candidate-downloads.json`}]}}}}
 const fetchImpl=async url=>{const runId=Number(url.match(/candidate-(\d+)-1/)[1]),prefix=`https://github.com/fatevase/dsh_depot/releases/download/candidate-${runId}-1/`;return Response.json({schemaVersion:1,runId,runAttempt:1,verification:'not-run',packages:[1,2].map(repositoryId=>({...file,repositoryId,repository:`owner/p${repositoryId}`,sourceCommit:commit,target:'linux-x64',assetName:`${repositoryId}-p-1.0.0-linux-x64.tgz`,url:prefix+`${repositoryId}-p-1.0.0-linux-x64.tgz`}))})}
 const result=await candidatePublicDownloads({github,snapshot,fetchImpl})
 assert.ok(result.plugins[0].results['linux-x64'].files[0].url.includes('candidate-10-1'))
 assert.ok(result.plugins[1].results['linux-x64'].files[0].url.includes('candidate-11-1'))
})

test('a single-platform retry merges only that platform and retains its own run identity',()=>{
 const initial=make(1,10),report=reportFor(1,'a'.repeat(40));report.plugins[0].results={'linux-x64':{status:'failed',verification:'not-run',repositoryId:1,commit:'a'.repeat(40),target:'linux-x64',error:'test'}};report.counts={compiled:0,failed:1,missing:0}
 const retry=candidateSnapshot(report,{config,run:{id:12,run_attempt:1,updated_at:'2026-10-22'},repository:'fatevase/dsh_depot',artifacts:[],partial:true})
 const merged=mergeCandidateSnapshots(mergeCandidateSnapshots(null,initial,config),retry,config)
 assert.equal(merged.plugins[0].results['linux-x64'].runId,12)
 assert.equal(merged.plugins[0].results['macos-arm64'].runId,10)
 assert.equal(merged.plugins[0].results['linux-x64'].status,'failed')
})
