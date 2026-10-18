#!/usr/bin/env node
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readRecipes, readJson, atomicJson, initialState, fileDigest } from './lib/model.mjs'
import { Github } from './lib/github.mjs'
import { discover } from './lib/discover.mjs'
import { createPlan } from './lib/plan.mjs'
import { configuredHost } from './lib/host-environment.mjs'
import { buildTask } from './lib/build.mjs'
import { prepareHost, verifyArtifact } from './lib/verify.mjs'
import { publishBatch, catalogOf } from './lib/publish.mjs'
import { mergeState, withdraw, rollback, updateStateBranch, githubStateStore } from './lib/state.mjs'
import { generateSite } from './lib/site.mjs'
import { writeReceipt, loadReceipt, receiptFiles } from './lib/receipts.mjs'
import { distributionRepository } from './lib/repository.mjs'
import { recoverPublishedReceipts } from './lib/republication.mjs'
import { recoverUnverifiedReceipts } from './lib/recover-ci.mjs'

export function argumentsOf(argv) {
  const result = { command: argv[0] }
  for (let i = 1; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) throw new Error(`Expected option, received ${argv[i]}`)
    const key = argv[i].slice(2)
    const value = !argv[i + 1] || argv[i + 1].startsWith('--') ? true : argv[++i]
    if (key === 'retry-key') (result.retryKeys ??= []).push(value)
    else result[key] = value
  }
  return result
}
export async function main(argv = process.argv.slice(2)) {
  const args = argumentsOf(argv), root = path.dirname(fileURLToPath(import.meta.url))
  const config = await readJson(args.config ?? path.join(root, 'config.json')); config.host=configuredHost(config.host)
  const remote = args.command === 'state-read' || args.publish === true
  const repository = distributionRepository(config, {requested: args.repository, runningRepository: remote ? process.env.GITHUB_REPOSITORY : undefined, required: remote})
  const workDir = path.resolve(args.work ?? path.join(root, '../.runtime/distribution'))
  const output = path.resolve(args.output ?? path.join(workDir, ({discover:'discovered.json',plan:'plan.json',build:'build-receipt.json',verify:'verification.json',publish:'publication-plan.json',site:'site'}[args.command]??`${args.command}.json`)))
  if (args.command === 'discover' || args.command === 'plan') {
    const recipes = await readRecipes(path.resolve(args.recipes ?? path.join(root, 'recipes')), {cohort:args.recipes?undefined:config.cohort?.plugins})
    const state = await readJson(args.state ?? path.join(workDir, 'state.json'), initialState())
    const github = new Github({ token: process.env.GITHUB_TOKEN, cache: state.apiCache??{} })
    state.availableArtifacts={}
    for(const [key,r] of Object.entries(state.receipts??{}))if(r.status==='verified'&&r.artifacts?.package){try{const sha256=await fileDigest(r.artifacts.package);if(sha256===r.artifacts.sha256)state.availableArtifacts[key]={sha256}}catch{}}
    const result = args.command === 'discover'
      ? await discover({ recipes, previous: state, github, candidateFeeds: config.candidateFeeds })
      : createPlan({ recipes, sources: (await readJson(args.discovered ?? path.join(workDir, 'discovered.json'))).sources, state, host: config.host, retryKeys: args.retryKeys ?? [] })
    await atomicJson(output, result)
    console.log(JSON.stringify({ command: args.command, output, tasks: result.tasks?.length, decisions: result.decisions?.length, complete: result.complete }))
    if (result.complete === false) process.exitCode = 1
    return result
  }
  const recipes = await readRecipes(path.resolve(args.recipes ?? path.join(root,'recipes')), {cohort:args.recipes?undefined:config.cohort?.plugins})
  const github = new Github({token:process.env.GITHUB_TOKEN})
  if(args.command==='build'||args.command==='verify'){
    const plan=await readJson(args.plan??path.join(workDir,'plan.json')),task=plan.tasks.find(t=>t.buildKey===args.key)
    if(!task)throw Error('Build key not present in plan')
    const recipe=recipes.find(r=>r.id===task.recipeId)
    if(args.command==='build'){const receipt=await buildTask(task,{recipe,workDir:path.join(workDir,'builds',task.buildKey),sourceArchive:args['source-archive']});await writeReceipt(output,receipt);console.log(JSON.stringify({status:receipt.status,output}));if(receipt.status!=='built')process.exitCode=1;return receipt}
    const receipt=await loadReceipt(args.artifact),host=await prepareHost({hostVersion:task.host.version,environmentDigest:task.host.environmentDigest,workDir:path.join(workDir,'stock-host'),dshBin:args['dsh-bin']})
    if(receipt.buildKey!==task.buildKey||receipt.status!=='built')throw Error('Artifact receipt does not match task')
    const verification=await verifyArtifact({task,recipe,artifact:receipt.artifacts,host,workDir:path.join(workDir,'verification',task.buildKey)})
    await atomicJson(output,verification)
    if(args['receipt-output'])await writeReceipt(path.resolve(args['receipt-output']),{...receipt,stage:'verify',status:verification.status==='passed'?'verified':verification.status,verification,error:verification.error})
    console.log(JSON.stringify({status:verification.status,output}));if(verification.status!=='passed')process.exitCode=1;return verification
  }
  if(args.command==='state-read'){
    const current=await githubStateStore({repository,branch:config.stateBranch,github}).read();await atomicJson(output,current.state);return current
  }
  if(['publish','withdraw','rollback'].includes(args.command)){
    const real=args.publish===true
    const current=real?(await githubStateStore({repository,branch:config.stateBranch,github}).read()).state:await readJson(args.state??path.join(workDir,'state.json'),initialState())
    let result
    if(args.command==='publish'){
      const files=await receiptFiles(path.resolve(args.receipts)),receipts=await Promise.all(files.map(loadReceipt)),plan=await readJson(args.plan??path.join(workDir,'plan.json'),{tasks:[]})
      for(const task of plan.tasks)if(!receipts.some(r=>r.buildKey===task.buildKey))receipts.push({...task,stage:'build',status:'missing',attempt:new Date().toISOString(),error:{message:'Matrix job did not return a receipt'}})
      const discovery=await readJson(args.discovered??path.join(workDir,'discovered.json'),null)
      const recovered=real?await recoverPublishedReceipts({state:current,repository,github,workDir:path.join(workDir,'republication'),recipeIds:new Set(recipes.filter(r=>r.enabled).map(r=>r.id)),excludeKeys:new Set(receipts.map(r=>r.buildKey))}):{receipts:[],tasks:[]}
      receipts.push(...recovered.receipts)
      const recoveredBuilds=real&&config.publication?.allowUnverified===true?await recoverUnverifiedReceipts({state:current,decisions:plan.decisions??[],recipes,repository,github,workDir:path.join(workDir,'recovered-builds'),excludeKeys:new Set(receipts.map(r=>r.buildKey))}):{receipts:[],tasks:[],unavailable:[]}
      receipts.push(...recoveredBuilds.receipts)
      const state=mergeState(current,{discovery})
      state.lastPlan={createdAt:plan.createdAt,cohort:config.cohort,decisions:plan.decisions??[]}
      result=await publishBatch({batchId:args.batch??process.env.GITHUB_RUN_ID??'local',repository,state,receipts,tasks:[...plan.tasks,...(plan.publicationTasks??[]),...recovered.tasks,...recoveredBuilds.tasks],github,dryRun:!real,recipes,allowUnverified:config.publication?.allowUnverified===true})
      if(real){const merged=await updateStateBranch({store:githubStateStore({repository,branch:config.stateBranch,github}),merge:latest=>{const next=mergeState(mergeState(latest,{discovery}),{receipts,publications:result.publications});if((next.lastPlan?.createdAt??'')<=(plan.createdAt??''))next.lastPlan=state.lastPlan;return next}});result.state=merged.state;result.catalog=catalogOf(merged.state,recipes)}
      result.unavailableBuilds=recoveredBuilds.unavailable
      result.cohort=config.cohort;result.decisions=plan.decisions??[]
    }else{
      const mutate=s=>args.command==='withdraw'?withdraw(s,args.key,args.reason):rollback(s,{key:args.key,recipeId:args.plugin,target:args.target,host:config.host})
      const state=real?(await updateStateBranch({store:githubStateStore({repository,branch:config.stateBranch,github}),merge:mutate})).state:mutate(current)
      result={schemaVersion:1,dryRun:!real,state,catalog:catalogOf(state,recipes)}
    }
    await atomicJson(output,result);await atomicJson(path.join(path.dirname(output),'catalog.json'),result.catalog);await atomicJson(path.join(path.dirname(output),'next-state.json'),result.state)
    console.log(JSON.stringify({output,dryRun:result.dryRun,actions:result.actions}));return result
  }
  if(args.command==='site'){
    const state=await readJson(args.state??path.join(workDir,'state.json'),initialState()),catalog=args.catalog?await readJson(args.catalog):undefined
    const result=await generateSite({catalog,state,recipes,outDir:output});console.log(JSON.stringify(result));return result
  }
  throw new Error('Usage: node distribution/cli.mjs discover|plan|build|verify|publish|site|withdraw|rollback|state-read --output <file> [--recipes <directory> --state <file>]')
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1 })
