import {readPluginList} from './lib/plugin-list.mjs'
import {readFile,appendFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import path from 'node:path'
import {Github} from './lib/github.mjs'
import {readJson,readRecipes} from './lib/model.mjs'
import {distributionRepository} from './lib/repository.mjs'
import {githubStateStore,updateStateBranch} from './lib/state.mjs'
import {generateSite} from './lib/site.mjs'
import {catalogOf} from './lib/publish.mjs'
import {latestManagerCatalog} from './lib/manager-catalog.mjs'
import {latestCandidateReport,withCandidateReport,retainCandidateReport} from './candidate-catalog.mjs'
import {candidatePublicDownloads} from './candidate-public-catalog.mjs'
import {refreshRepositoryAbout,applyRepositoryAbout} from './repository-about.mjs'
import {applyCategories} from '../web/categories.mjs'
import {shouldRefreshWebsite} from './lib/site-trigger.mjs'

export async function main(command=process.argv[2],env=process.env){
 const config=await readJson(new URL('./config.json',import.meta.url))
 const repository=distributionRepository(config,{required:true,runningRepository:env.GITHUB_REPOSITORY})
 const github=new Github({token:env.GITHUB_TOKEN})
 if(command==='gate'){
  const event=JSON.parse(await readFile(env.GITHUB_EVENT_PATH,'utf8'))
  let allow=false
  if(env.GITHUB_EVENT_NAME==='workflow_run'){
   const run=event.workflow_run
   if(run?.head_repository?.full_name===repository && run.head_branch===event.repository.default_branch && (['push','schedule','workflow_dispatch'].includes(run.event)||run.path==='.github/workflows/candidate-downloads.yml'&&run.event==='workflow_run') && Number.isSafeInteger(run.id)){
    const jobs=[]
    for(let page=1;page<=10;page++){
     const result=await github.request(`/repos/${repository}/actions/runs/${run.id}/jobs?filter=latest&per_page=100&page=${page}`)
     jobs.push(...result.data.jobs)
     if(result.data.jobs.length<100)break
    }
    allow=run.path==='.github/workflows/candidate-builds.yml'
     ? jobs.some(job=>job.name==='report'&&job.conclusion==='success')
     : shouldRefreshWebsite({run,jobs,repository,defaultBranch:event.repository.default_branch})
   }
  }else allow=['push','workflow_dispatch'].includes(env.GITHUB_EVENT_NAME) && env.GITHUB_REF===`refs/heads/${event.repository.default_branch}`
  if(env.GITHUB_OUTPUT)await appendFile(env.GITHUB_OUTPUT,`allow=${allow}\n`)
  return{allow}
 }
 if(command==='build'){
  const selection=await readPluginList(config,fileURLToPath(new URL('.',import.meta.url)))
  const recipes=await readRecipes(fileURLToPath(new URL('./recipes/',import.meta.url)),{cohort:selection.active})
  const store=githubStateStore({repository,branch:config.stateBranch,github})
  let current=await store.read()
  const candidateReport=await latestCandidateReport({github,repository,config:await readJson(new URL('./candidate-builds.json',import.meta.url)),previous:current.state.candidateReport})
  if(candidateReport)current=await updateStateBranch({store,merge:state=>retainCandidateReport(state,candidateReport)})
  const baseCatalog=withCandidateReport(catalogOf(current.state,recipes),await candidatePublicDownloads({github,snapshot:current.state.candidateReport}))
  const seed=await readJson(new URL('../docs/evidence/repository-about-2026-10-20.json',import.meta.url))
  const about=await refreshRepositoryAbout({github,repositories:baseCatalog.plugins.map(p=>({repository:p.repository,repositoryId:p.trial?.repositoryId})),previous:{...seed.repositories,...current.state.repositoryAbout}})
  current=await updateStateBranch({store,merge:state=>({...state,repositoryAbout:{...state.repositoryAbout,...about}})})
  const catalog=applyCategories(applyRepositoryAbout(baseCatalog,about),selection.candidates)
  const result=await generateSite({catalog,outDir:fileURLToPath(new URL('../.runtime/web/site',import.meta.url)),managerCatalog:await latestManagerCatalog({github})})
  return {...result,stateCommit:current.commit,candidateBuild:catalog.candidateBuild}
 }
 throw Error('Usage: node distribution/deploy-site.mjs gate|build')
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().then(r=>console.log(JSON.stringify(r)),e=>{console.error(e.message);process.exitCode=1})
