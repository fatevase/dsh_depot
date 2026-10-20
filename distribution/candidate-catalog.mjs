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
 for(const run of runs){
  if(run.path!==repoPath||run.head_repository?.id!==repo.id||run.head_branch!==repo.default_branch||!['push','workflow_dispatch'].includes(run.event))continue
  if(previous?.runId===run.id&&previous.completedAt===run.updated_at)return previous
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
   // Partial retries do not replace the full catalog snapshot.
   if(!Array.isArray(report.plugins)||report.plugins.length!==config.entries.length||report.plugins.some(p=>targets.some(t=>!p.results?.[t])))continue
   return candidateSnapshot(report,{run,artifacts,config,repository})
  }finally{await rm(dir,{recursive:true,force:true})}
 }
 return null
}

export function candidateSnapshot(report,{run,artifacts,config,repository}){
 if(report.schemaVersion!==1||report.verification!=='not-run'||report.campaign!==config.id)throw Error('Invalid candidate report identity')
 const expected=new Map(config.entries.map(e=>[e.repositoryId,e])),seen=new Set(),counts={compiled:0,failed:0,missing:0}
 const runUrl=`https://github.com/${repository}/actions/runs/${run.id}`
 const plugins=report.plugins.map(p=>{
  const entry=expected.get(p.repositoryId)
  if(!entry||seen.has(p.repositoryId)||p.repository.toLowerCase()!==entry.repository.toLowerCase())throw Error('Invalid candidate repository identity')
  seen.add(p.repositoryId)
  if(Object.keys(p.results??{}).some(t=>!targets.includes(t)))throw Error('Unexpected candidate report platform')
  const results=Object.fromEntries(targets.map(target=>{
   const r=p.results?.[target]
   if(!r||!['compiled','failed','missing'].includes(r.status))throw Error('Incomplete candidate platform report')
   counts[r.status]++
   if(r.status!=='missing'&&(r.verification!=='not-run'||r.repositoryId!==p.repositoryId||r.commit!==p.commit||r.target!==target))throw Error('Candidate receipt identity mismatch')
   const batch=Math.floor(config.entries.findIndex(e=>e.repositoryId===p.repositoryId)/config.batchSize)+1
   const artifact=artifacts.find(a=>a.name===`candidate-batch-${batch}-${target}`&&!a.expired)
   return [target,{status:r.status,version:r.package?.version,error:r.error?.slice(0,5000),errorCategory:r.errorCategory,
    artifactsUrl:r.status==='compiled'&&artifact?`${runUrl}/artifacts/${artifact.id}`:undefined,
    artifactsExpiresAt:artifact?.expires_at,
    files:(r.artifacts??[]).map(a=>({name:a.name,version:a.version,filename:a.filename,bytes:a.bytes,sha256:a.sha256}))}]
  }))
  return {repositoryId:p.repositoryId,repository:p.repository,npmName:p.npmName,commit:p.commit,runUrl,results}
 })
 if(seen.size!==expected.size)throw Error('Candidate snapshot does not cover the maintained list')
 for(const key of Object.keys(counts))if(report.counts?.[key]!==counts[key])throw Error('Candidate report counts mismatch')
 return {schemaVersion:1,runId:run.id,runUrl,completedAt:run.updated_at,counts,plugins}
}

export function withCandidateReport(catalog,snapshot){
 if(!snapshot)return catalog
 const plugins=catalog.plugins.map(p=>({...p})),byRepo=new Map(plugins.map(p=>[p.repository.toLowerCase(),p]))
 for(const trial of snapshot.plugins){
  const old=byRepo.get(trial.repository.toLowerCase())
  const visible={...trial,results:Object.fromEntries(Object.entries(trial.results).map(([t,r])=>[t,{...r,artifactsUrl:Date.parse(r.artifactsExpiresAt)>Date.now()?r.artifactsUrl:undefined}]))}
  if(old){old.trial=visible;continue}
  plugins.push({id:`candidate-${trial.repositoryId}`,name:trial.repository.split('/')[1],repository:trial.repository,npmName:trial.npmName,category:'tools',status:'trial',description:'',seed:{commit:trial.commit},trial:visible})
 }
 return {...catalog,plugins,candidateBuild:{runId:snapshot.runId,runUrl:snapshot.runUrl,completedAt:snapshot.completedAt,counts:snapshot.counts,pluginCount:snapshot.plugins.length}}
}

export function retainCandidateReport(state,snapshot){
 const old=state.candidateReport
 if(!snapshot||old&&(old.runId>snapshot.runId||old.runId===snapshot.runId&&Date.parse(old.completedAt)>=Date.parse(snapshot.completedAt)))return state
 return {...state,candidateReport:snapshot}
}
