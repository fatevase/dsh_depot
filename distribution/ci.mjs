import {readPluginList} from './lib/plugin-list.mjs'
import {fileURLToPath} from 'node:url'
import { supportedTarget } from './lib/platform.mjs'
// CI adapter: all untrusted/event inputs stay data, never interpolated into shell.
import path from 'node:path'
import { appendFile, mkdir } from 'node:fs/promises'
import { configuredHost } from './lib/host-environment.mjs'
import { Github } from './lib/github.mjs'
import { readRecipes, readJson, atomicJson, initialState } from './lib/model.mjs'
import { githubStateStore } from './lib/state.mjs'
import { discover } from './lib/discover.mjs'
import { createPlan } from './lib/plan.mjs'
import { buildTask } from './lib/build.mjs'
import { prepareHost, verifyArtifact } from './lib/verify.mjs'
import { writeReceipt } from './lib/receipts.mjs'
import { main } from './cli.mjs'
import { distributionRepository } from './lib/repository.mjs'
const root=path.resolve('.runtime/distribution'),batch=path.join(root,'batch'),config=await readJson('distribution/config.json'),command=process.argv[2]
config.host=configuredHost(config.host)
const repository=distributionRepository(config,{required:true,runningRepository:process.env.GITHUB_REPOSITORY})
const selection=await readPluginList(config,fileURLToPath(new URL('.',import.meta.url)))
config.cohort={...config.cohort,plugins:selection.active}
const recipes=await readRecipes('distribution/recipes',{cohort:selection.active})
const runners={'macos-arm64':'macos-15','linux-x64':'ubuntu-24.04','win32-x64':'windows-2025'}
if(process.env.ONLY_TARGET&&!supportedTarget(process.env.ONLY_TARGET))throw Error('Unsupported target')
if(command==='discover'){
 const github=new Github({token:process.env.GITHUB_TOKEN})
 const current=await githubStateStore({repository,branch:config.stateBranch,github}).read()
 github.cache=current.state.apiCache??{}
 const discovery=await discover({recipes,previous:current.state,github,candidateFeeds:config.candidateFeeds,maintainedCandidates:selection.candidates})
 const plan=createPlan({recipes,sources:discovery.sources,state:current.state,host:config.host,retryKeys:(process.env.RETRY_KEYS??'').split(',').filter(Boolean)})
 plan.tasks=plan.tasks.filter(t=>(!process.env.ONLY_PLUGIN||t.recipeId===process.env.ONLY_PLUGIN)&&(!process.env.ONLY_TARGET||t.target===process.env.ONLY_TARGET))
 await atomicJson(path.join(batch,'state.json'),current.state);await atomicJson(path.join(batch,'discovered.json'),discovery);await atomicJson(path.join(batch,'plan.json'),plan)
 const matrix={include:plan.tasks.map(t=>({key:t.buildKey,runner:runners[t.target],target:t.target,recipeId:t.recipeId}))}
 if(process.env.GITHUB_OUTPUT)await appendFile(process.env.GITHUB_OUTPUT,`matrix=${JSON.stringify(matrix)}\nhas_tasks=${plan.tasks.length>0}\n`)
 console.log(JSON.stringify({tasks:plan.tasks.length,decisions:plan.decisions,discoveryErrors:discovery.errors}))
}else if(command==='build'){
 const plan=await readJson(path.join(batch,'plan.json')),task=plan.tasks.find(t=>t.buildKey===process.env.BUILD_KEY);if(!task)throw Error('Unknown matrix build key')
 const recipe=recipes.find(r=>r.id===task.recipeId),job=path.join(root,'jobs',task.buildKey);await mkdir(job,{recursive:true})
 let receipt
 try{
   receipt=await buildTask(task,{recipe,workDir:path.join(root,'builds',task.buildKey)})
   if(receipt.status==='built'){
    const host=await prepareHost({hostVersion:task.host.version,environmentDigest:task.host.environmentDigest,workDir:path.join(root,'stock-host')})
    const verification=await verifyArtifact({task,recipe,artifact:receipt.artifacts,host,workDir:path.join(root,'verification',task.buildKey)})
    receipt={...receipt,stage:'verify',status:verification.status==='passed'?'verified':verification.status,verification,error:verification.error}
   }
 }catch(error){receipt={...(receipt??task),schemaVersion:1,status:'unverified',stage:'verify',attempt:new Date().toISOString(),error:{message:error.message}}}
 await writeReceipt(path.join(job,'receipt.json'),receipt)
 console.log(JSON.stringify({buildKey:task.buildKey,status:receipt.status,error:receipt.error}));if(receipt.status!=='verified')process.exitCode=1
}else if(command==='publish'){
 await mkdir(path.join(root,'jobs'),{recursive:true})
 await main(['publish','--receipts',path.join(root,'jobs'),'--state',path.join(batch,'state.json'),'--plan',path.join(batch,'plan.json'),'--discovered',path.join(batch,'discovered.json'),'--output',path.join(root,'publication-plan.json'),'--batch',process.env.GITHUB_RUN_ID,'--publish'])
}else throw Error('Usage: node distribution/ci.mjs discover|build|publish')
