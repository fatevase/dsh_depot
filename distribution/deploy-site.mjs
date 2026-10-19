import {readPluginList} from './lib/plugin-list.mjs'
import {readFile,appendFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import path from 'node:path'
import {Github} from './lib/github.mjs'
import {readJson,readRecipes} from './lib/model.mjs'
import {distributionRepository} from './lib/repository.mjs'
import {githubStateStore} from './lib/state.mjs'
import {refreshDeployment} from './lib/deploy.mjs'
import {latestManagerCatalog} from './lib/manager-catalog.mjs'
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
   if(run?.head_repository?.full_name===repository && run.head_branch===event.repository.default_branch && ['push','schedule','workflow_dispatch'].includes(run.event) && Number.isSafeInteger(run.id)){
    const jobs=[]
    for(let page=1;page<=10;page++){
     const result=await github.request(`/repos/${repository}/actions/runs/${run.id}/jobs?filter=latest&per_page=100&page=${page}`)
     jobs.push(...result.data.jobs)
     if(result.data.jobs.length<100)break
    }
    allow=shouldRefreshWebsite({run,jobs,repository,defaultBranch:event.repository.default_branch})
   }
  }else allow=['push','workflow_dispatch'].includes(env.GITHUB_EVENT_NAME) && env.GITHUB_REF===`refs/heads/${event.repository.default_branch}`
  if(env.GITHUB_OUTPUT)await appendFile(env.GITHUB_OUTPUT,`allow=${allow}\n`)
  return{allow}
 }
 if(command==='build'){
  const selection=await readPluginList(config,fileURLToPath(new URL('.',import.meta.url)))
  const recipes=await readRecipes(fileURLToPath(new URL('./recipes/',import.meta.url)),{cohort:selection.active})
  const store=githubStateStore({repository,branch:config.stateBranch,github})
  return refreshDeployment({store,recipes,outDir:fileURLToPath(new URL('../.runtime/web/site',import.meta.url)),managerCatalog:await latestManagerCatalog({github})})
 }
 throw Error('Usage: node distribution/deploy-site.mjs gate|build')
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().then(r=>console.log(JSON.stringify(r)),e=>{console.error(e.message);process.exitCode=1})
