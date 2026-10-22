// Project completed trial receipts into the existing Pages catalog.json.
import path from 'node:path'
import os from 'node:os'
import {mkdtemp, rm, stat} from 'node:fs/promises'
import {readJson, fileDigest} from './lib/model.mjs'
import {extractArchive} from './lib/build.mjs'

const targets=['macos-arm64','linux-x64','win32-x64']
const repoPath='.github/workflows/candidate-builds.yml'
export async function latestCandidateReport({github,repository,config,previous}){
 const repo=(await github.request(`/repos/${repository}`)).data
 const runs=(await github.request(`/repos/${repository}/actions/workflows/candidate-builds.yml/runs?branch=${encodeURIComponent(repo.default_branch)}&status=completed&per_page=30`)).data.workflow_runs
 let snapshot=previous,changed=false
 for(const run of [...runs].sort((a,b)=>a.id-b.id)){
  if(snapshot&&run.id<snapshot.runId)continue
  if(run.path!==repoPath||run.head_repository?.id!==repo.id||run.head_branch!==repo.default_branch||!['push','workflow_dispatch','schedule'].includes(run.event))continue
  if(snapshot?.projectionVersion===3&&snapshot.runId===run.id&&snapshot.completedAt===run.updated_at)continue
  const artifacts=(await github.request(`/repos/${repository}/actions/runs/${run.id}/artifacts?per_page=100`)).data.artifacts
  const artifact=artifacts.find(a=>a.name==='candidate-build-report'&&!a.expired)
  if(!artifact)continue
  const jobs=(await github.request(`/repos/${repository}/actions/runs/${run.id}/jobs?per_page=100&filter=latest`)).data.jobs
  if(!jobs.some(j=>j.name==='report'&&j.conclusion==='success'))continue
  if(artifact.size_in_bytes>8*1024*1024)throw Error('Candidate report archive too large')
  const dir=await mkdtemp(path.join(os.tmpdir(),'depot-candidates-'))
  try{
   const zip=path.join(dir,'report.zip'),contents=path.join(dir,'contents')
   await github.download(`/repos/${repository}/actions/artifacts/${artifact.id}/zip`,zip)
   if(artifact.digest&&artifact.digest!==`sha256:${await fileDigest(zip)}`)throw Error('Candidate report archive digest mismatch')
   await extractArchive(zip,contents,{strip:0})
   const reportFile=path.join(contents,'report.json')
   if((await stat(reportFile)).size>8*1024*1024)throw Error('Candidate report JSON too large')
   const report=await readJson(reportFile)
   // Merge completed partial batches and per-platform retries into the current snapshot.
   if(!Array.isArray(report.plugins)||!report.plugins.length||report.plugins.some(p=>!Object.keys(p.results??{}).length||Object.keys(p.results).some(t=>!targets.includes(t))))continue
   snapshot=mergeCandidateSnapshots(snapshot,candidateSnapshot(report,{run,artifacts,config,repository,partial:true}),config);changed=true
  }finally{await rm(dir,{recursive:true,force:true})}
 }
 return changed?snapshot:previous??null
}

export function candidateSnapshot(report,{run,artifacts,config,repository,partial=false}){
 if(report.schemaVersion!==1||report.verification!=='not-run'||report.campaign!==config.id)throw Error('Invalid candidate report identity')
 const expected=new Map(config.entries.map(e=>[e.repositoryId,e])),seen=new Set(),counts={compiled:0,failed:0,missing:0}
 const runUrl=`https://github.com/${repository}/actions/runs/${run.id}`
 const plugins=report.plugins.map(p=>{
  const entry=expected.get(p.repositoryId)
  if(!entry||seen.has(p.repositoryId)||p.repository.toLowerCase()!==entry.repository.toLowerCase())throw Error('Invalid candidate repository identity')
  seen.add(p.repositoryId)
  if(Object.keys(p.results??{}).some(t=>!targets.includes(t)))throw Error('Unexpected candidate report platform')
  const results=Object.fromEntries((partial?Object.keys(p.results??{}):targets).map(target=>{
   const r=p.results?.[target]
   if(!r||!['compiled','failed','missing'].includes(r.status))throw Error('Incomplete candidate platform report')
   counts[r.status]++
   if(r.status!=='missing'&&(r.verification!=='not-run'||r.repositoryId!==p.repositoryId||r.commit!==p.commit||r.target!==target))throw Error('Candidate receipt identity mismatch')
   const batch=Math.floor(config.entries.findIndex(e=>e.repositoryId===p.repositoryId)/config.batchSize)+1
   const artifact=artifacts.find(a=>a.name===`candidate-batch-${batch}-${target}`&&!a.expired)
   return [target,{runId:run.id,runAttempt:run.run_attempt??1,status:r.status,verification:'not-run',startedAt:r.startedAt,seconds:r.seconds,stage:r.stage,dependencyMode:r.dependencyMode,adapterDigest:r.adapterDigest,sourceSha256:r.sourceSha256,lockSha256:r.lockSha256,
    steps:(r.steps??[]).map(s=>({stage:s.stage,argv:s.argv,cwd:s.cwd,exitCode:s.exitCode,seconds:s.seconds})),
    dependencies:r.dependencies,runtimeDependencies:r.runtimeDependencies,buildDependencies:r.buildDependencies,
    version:r.package?.version,error:r.error?.slice(0,5000),errorCategory:r.errorCategory,warnings:r.warnings??[],
    artifactsUrl:r.status==='compiled'&&artifact?`${runUrl}/artifacts/${artifact.id}`:undefined,
    artifactsExpiresAt:artifact?.expires_at,
    files:(r.artifacts??[]).map(a=>({name:a.name,version:a.version,filename:a.filename,bytes:a.bytes,sha256:a.sha256,origin:a.origin,inputs:a.inputs,hostPeers:a.hostPeers,hostCompatibility:a.hostCompatibility}))}]
  }))
  return {repositoryId:p.repositoryId,repository:p.repository,npmName:p.npmName,commit:p.commit,runId:run.id,runAttempt:run.run_attempt??1,runUrl,results}
 })
 if(!partial&&seen.size!==expected.size)throw Error('Candidate snapshot does not cover the maintained list')
 for(const key of Object.keys(counts))if(report.counts?.[key]!==counts[key])throw Error('Candidate report counts mismatch')
 return {schemaVersion:1,projectionVersion:2,runId:run.id,runAttempt:run.run_attempt,runUrl,completedAt:run.updated_at,counts,plugins}
}

export function withCandidateReport(catalog,snapshot){
 if(!snapshot)return catalog
 const plugins=catalog.plugins.map(p=>({...p})),byRepo=new Map(plugins.map(p=>[p.repository.toLowerCase(),p]))
 for(const trial of snapshot.plugins){
  const old=byRepo.get(trial.repository.toLowerCase())
  const visible={...trial,results:Object.fromEntries(Object.entries(trial.results).map(([t,r])=>[t,{...r,artifactsUrl:undefined}]))}
  if(old){
   const outdated=old.latestOnly&&(old.latestRefreshError||old.seed?.commit!==trial.commit)
   old.trial=outdated?{...visible,outdated:true,results:Object.fromEntries(Object.entries(visible.results).map(([t,r])=>[t,{...r,status:'missing',version:undefined,files:[]}]))}:visible;continue
  }
  plugins.push({id:`candidate-${trial.repositoryId}`,name:trial.repository.split('/')[1],repository:trial.repository,npmName:trial.npmName,category:'tools',status:'trial',description:'',seed:{commit:trial.commit},trial:visible})
 }
 return {...catalog,plugins,candidateBuild:{runId:snapshot.runId,runAttempt:snapshot.runAttempt??1,runUrl:snapshot.runUrl,completedAt:snapshot.completedAt,counts:snapshot.counts,pluginCount:snapshot.plugins.length}}
}

export function retainCandidateReport(state,snapshot){
 const old=state.candidateReport
 if(!snapshot||old&&(old.runId>snapshot.runId||old.runId===snapshot.runId&&(old.projectionVersion??1)>=(snapshot.projectionVersion??1)&&Date.parse(old.completedAt)>=Date.parse(snapshot.completedAt)))return state
 return {...state,candidateReport:snapshot}
}

export function mergeCandidateSnapshots(previous,next,config){
 const found=new Map((previous?.plugins??[]).map(p=>[p.repositoryId,{...p,runId:p.runId??previous.runId,runAttempt:p.runAttempt??previous.runAttempt??1,results:Object.fromEntries(Object.entries(p.results).map(([t,r])=>[t,{...r,runId:r.runId??p.runId??previous.runId,runAttempt:r.runAttempt??p.runAttempt??previous.runAttempt??1}]))}]))
 const emptyResults=()=>Object.fromEntries(targets.map(t=>[t,{status:'missing',verification:'not-run',files:[]}]))
 for(const p of next.plugins){const old=found.get(p.repositoryId);found.set(p.repositoryId,{...p,results:{...(old?.commit===p.commit?old.results:emptyResults()),...p.results}})}
 const plugins=config.entries.map(e=>found.get(e.repositoryId)??{repositoryId:e.repositoryId,repository:e.repository,npmName:e.npmName,results:emptyResults()})
 const counts={compiled:0,failed:0,missing:0}
 for(const p of plugins)for(const r of Object.values(p.results))counts[r.status]++
 return {...next,projectionVersion:3,plugins,counts}
}
