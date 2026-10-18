import path from 'node:path'
import { mkdir } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { fileDigest, jsonDigest } from './model.mjs'
import { loadReceipt } from './receipts.mjs'
import { publicationChannelOf } from './publish.mjs'
const execute=promisify(execFile)
export async function extractCiPackage(archive,dir){
 await execute(process.platform==='win32'?'python':'python3',[fileURLToPath(new URL('./ci-archive.py',import.meta.url)),archive,dir])
 return loadReceipt(path.join(dir,'receipt.json'))
}
// Recover current completed builds after policy changes, without recompiling them.
export async function recoverUnverifiedReceipts({state,decisions,recipes,repository,github,workDir,excludeKeys=new Set(),extract=extractCiPackage}){
 const pending=decisions.filter(d=>d.buildKey&&!excludeKeys.has(d.buildKey)&&!state.published[d.buildKey]&&!state.withdrawn[d.buildKey]).map(d=>state.receipts[d.buildKey]).filter(r=>r?.stage==='verify'&&['failed','unverified'].includes(r.status)&&r.verification?.error?.message)
 if(!pending.length)return {receipts:[],tasks:[],unavailable:[]}
 const repo=(await github.request(`/repos/${repository}`)).data,receipts=[],tasks=[],unavailable=[]
 for(const original of pending){
  publicationChannelOf(original,recipes.find(r=>r.id===original.recipeId),{allowUnverified:true})
  const name=`distribution-result-${original.buildKey}`
  const artifacts=(await github.request(`/repos/${repository}/actions/artifacts?name=${name}&per_page=100`)).data.artifacts
  const artifact=artifacts.filter(a=>!a.expired&&a.name===name&&a.workflow_run?.head_repository_id===repo.id&&a.workflow_run?.head_branch===repo.default_branch).sort((a,b)=>b.created_at.localeCompare(a.created_at))[0]
  if(!artifact){unavailable.push({buildKey:original.buildKey,reason:'Build artifact expired or unavailable; explicitly retry this plugin to rebuild'});continue}
  const run=(await github.request(`/repos/${repository}/actions/runs/${artifact.workflow_run.id}`)).data
  if(run.path!=='.github/workflows/plugin-distribution.yml'||!['push','schedule','workflow_dispatch'].includes(run.event)||run.head_sha!==artifact.workflow_run.head_sha)throw Error('Build artifact is not from the distribution workflow on the default branch')
  const dir=path.join(workDir,original.buildKey);await mkdir(dir,{recursive:true})
  const zip=path.join(dir,'artifact.zip');await github.download(`/repos/${repository}/actions/artifacts/${artifact.id}/zip`,zip)
  const receipt=await extract(zip,path.join(dir,'contents'))
  for(const key of ['buildKey','recipeId','recipeDigest','source','host','target','plannedAt','stage','status','verification'])if(jsonDigest(receipt[key])!==jsonDigest(original[key]))throw Error(`Recovered receipt differs from recorded ${key}`)
  if(receipt.artifacts.sha256!==original.artifacts.sha256||await fileDigest(receipt.artifacts.package)!==original.artifacts.sha256)throw Error('Recovered build checksum mismatch')
  receipts.push(receipt);tasks.push(Object.fromEntries(['buildKey','recipeId','recipeDigest','source','host','target','plannedAt'].map(k=>[k,receipt[k]])))
 }
 return {receipts,tasks,unavailable}
}
