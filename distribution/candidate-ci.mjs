import path from 'node:path'
import {appendFile, mkdir, readdir, readFile, writeFile} from 'node:fs/promises'
import {Github} from './lib/github.mjs'
import {readJson, atomicJson} from './lib/model.mjs'
import {prepareTools} from './lib/process.mjs'
import {runtimeTarget} from './lib/platform.mjs'
import {campaignMatrix, buildCandidate, summarizeCampaign, campaignMarkdown} from './lib/candidate-build.mjs'
import {selectCandidateUpdates,candidateInputKey} from './lib/candidate-updates.mjs'
import {latestSource} from './lib/latest.mjs'
import {githubStateStore,updateStateBranch} from './lib/state.mjs'
import {freezeCandidateInputs} from './lib/candidate-inputs.mjs'

const root=path.resolve('.runtime/candidate-builds'),command=process.argv[2]
const config=await readJson('distribution/candidate-builds.json')
const runUrl=`https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
const repository='fatevase/dsh_depot'
const github=new Github({token:process.env.GITHUB_TOKEN})
if(process.env.GITHUB_REPOSITORY&&process.env.GITHUB_REPOSITORY!==repository)throw Error('Unexpected distribution repository')

if(command==='prepare'){
 const list=await readJson(config.sourceList)
 const candidates=new Set(list.candidates.map(e=>e.repositoryId))
 if(config.entries.length!==candidates.size||config.entries.some(e=>!candidates.has(e.repositoryId)))throw Error('Campaign must cover exactly the maintained candidate list')
 const fullMatrix=campaignMatrix(config,{...(process.env.ONLY_BATCH?{batch:Number(process.env.ONLY_BATCH)}:{}),...(process.env.ONLY_TARGET?{target:process.env.ONLY_TARGET}:{})})
 const entries=[...new Map(fullMatrix.include.flatMap(j=>j.entries).map(e=>[e.repositoryId,e])).values()]
 // Credentials are used only here, before any upstream code is downloaded/run.
 for(let offset=0;offset<entries.length;offset+=4)await Promise.all(entries.slice(offset,offset+4).map(async e=>{
  try{
   const meta=(await github.request(`/repos/${e.repository}`)).data
   if(meta.id!==e.repositoryId)throw Error('GitHub repository ID changed')
   const selected=await latestSource({...e,channel:{allowPrerelease:false}},github)
   e.ref=selected.ref
   const commit=selected.commit
   if(!/^[a-f0-9]{40}$/.test(commit))throw Error('Invalid source commit')
   e.commit=commit
   await freezeCandidateInputs(e,github)
  }catch(error){e.error=`Source discovery: ${error.message}`}
 }))
 const previous=(await githubStateStore({repository,branch:'candidate-state',github}).read()).state.candidateInputs??{}
 const selected=selectCandidateUpdates({...config,entries:config.entries},{scheduled:process.env.GITHUB_EVENT_NAME==='schedule',previous,...(process.env.ONLY_BATCH?{batch:Number(process.env.ONLY_BATCH)}:{}),...(process.env.ONLY_TARGET?{target:process.env.ONLY_TARGET}:{})})
 const {matrix}=selected
 const plan={...config,...selected,createdAt:new Date().toISOString(),sourceCommit:process.env.GITHUB_SHA}
 await atomicJson(path.join(root,'plan.json'),plan)
 if(process.env.GITHUB_OUTPUT)await appendFile(process.env.GITHUB_OUTPUT,`matrix=${JSON.stringify(matrix)}\n`)
 console.log(JSON.stringify({plugins:entries.length,jobs:matrix.include.length,discoveryFailures:entries.filter(e=>e.error).length}))
}else if(command==='build'){
 const plan=await readJson(path.join(root,'plan.json'))
 const job=plan.matrix.include.find(j=>j.batch===Number(process.env.CANDIDATE_BATCH)&&j.target===process.env.CANDIDATE_TARGET)
 if(!job||job.target!==runtimeTarget(process.platform,process.arch))throw Error('Batch target does not match this native runner')
 const tools=new Map();let failed=0
 for(const entry of job.entries){
  const workDir=path.join(root,'results',String(entry.repositoryId));await mkdir(workDir,{recursive:true})
  let prepared,preparationError
  try{
   if((!entry.prebuilt||entry.prebuilt.runtimePackages)&&!entry.error&&!entry.blockedReason){
    const key=entry.pnpmVersion??'11.25.0'
    if(!tools.has(key))tools.set(key,await prepareTools({node:'26.9.0',npm:'11.19.1',pnpm:key},path.join(root,'tools',key)))
    prepared=tools.get(key)
   }
  }catch(error){preparationError=`Toolchain: ${error.message}`}
  const receipt=await buildCandidate(entry,{workDir,tools:prepared,preparationError})
  if(receipt.status!=='compiled')failed++
  console.log(JSON.stringify({repository:entry.repository,target:job.target,status:receipt.status,error:receipt.error,errorCategory:receipt.errorCategory,components:receipt.artifacts?.length,seconds:receipt.seconds}))
 }
 if(failed)process.exitCode=1
}else if(command==='report'){
 const plan=await readJson(path.join(root,'plan.json')),receipts=[]
 async function collect(dir){for(const e of await readdir(dir,{withFileTypes:true}).catch(()=>[])){
  const file=path.join(dir,e.name)
  if(e.isDirectory())await collect(file)
  else if(e.name==='receipt.json')receipts.push(await readJson(file))
 }}
 await collect(path.join(root,'downloaded'))
 const report=summarizeCampaign(plan,receipts)
 await atomicJson(path.join(root,'report.json'),report)
 const markdown=campaignMarkdown(report,runUrl)
 await writeFile(path.join(root,'report.md'),markdown+'\n')
 if(process.env.GITHUB_STEP_SUMMARY)await appendFile(process.env.GITHUB_STEP_SUMMARY,markdown+'\n')
 if(process.env.GITHUB_TOKEN&&plan.entries.length){
  if(process.env.GITHUB_REF!=='refs/heads/main')throw Error('Issue reports only run on main')
  await updateStateBranch({store:githubStateStore({repository,branch:'candidate-state',github}),merge:state=>{
   state.candidateInputs??={}
   for(const p of report.plugins)for(const [target,r]of Object.entries(p.results))if(r.status!=='missing')state.candidateInputs[`${p.repositoryId}:${target}`]=candidateInputKey(plan.entries.find(e=>e.repositoryId===p.repositoryId),target)
   state.checkedAt=plan.createdAt;return state
  }})
  // A full campaign owns the marked checklist; a partial retry adds a comment.
  if(plan.entries.length===config.entries.length&&plan.targets.length===config.targets.length){
   const issue=(await github.request(`/repos/${repository}/issues/${config.issue}`)).data
   const body=issue.body??'',pattern=/<!-- candidate-build:start -->[\s\S]*?<!-- candidate-build:end -->/
   await github.request(`/repos/${repository}/issues/${config.issue}`,{method:'PATCH',body:{body:pattern.test(body)?body.replace(pattern,()=>markdown):`${body}\n\n${markdown}`.trim()}})
  }else await github.request(`/repos/${repository}/issues/${config.issue}/comments`,{method:'POST',body:{body:markdown}})
 }
 console.log(JSON.stringify(report.counts))
 if(report.counts.missing)process.exitCode=1
}else throw Error('Usage: node distribution/candidate-ci.mjs prepare|build|report')
