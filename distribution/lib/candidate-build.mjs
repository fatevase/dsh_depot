// Trial compilation only. These receipts cannot enter the release publisher.
import path from 'node:path'
import {mkdir, access, copyFile} from 'node:fs/promises'
import {readJson, atomicJson, fileDigest, jsonDigest, within} from './model.mjs'
import {isolatedEnv, runCommand, resolveTools, prepareTools, commandArgv} from './process.mjs'
import {runtimeTarget} from './platform.mjs'
import {assertCandidate, acquireSource, prepareSourceDependencies, prepareAssets, applySourcePatches} from './candidate-inputs.mjs'
import {packCandidate, importPrebuilt} from './candidate-pack.mjs'

const runners={'macos-arm64':'macos-15','linux-x64':'ubuntu-24.04','win32-x64':'windows-2025'}
const exists=async file=>{try{await access(file);return true}catch{return false}}
export function campaignMatrix(config,{batch,target}={}){
 if(!Number.isInteger(config.batchSize)||config.batchSize<1||config.batchSize>5)throw Error('Invalid batch size')
 const ids=new Set(),repos=new Set()
 for(const e of config.entries){
  assertCandidate(e)
  if(!Number.isSafeInteger(e.repositoryId)||ids.has(e.repositoryId)||!/^[\w.-]+\/[\w.-]+$/.test(e.repository)||repos.has(e.repository.toLowerCase()))throw Error('Invalid or duplicate campaign repository')
  ids.add(e.repositoryId);repos.add(e.repository.toLowerCase())
 }
 const batches=Math.ceil(config.entries.length/config.batchSize)
 if(batch!==undefined&&(!Number.isInteger(batch)||batch<1||batch>batches))throw Error('Unknown campaign batch')
 if(target&&!config.targets.includes(target))throw Error('Unknown campaign target')
 const include=[]
 for(let i=0;i<batches;i++)for(const t of config.targets){
  if(!runners[t])throw Error('Unsupported campaign target')
  if((batch&&batch!==i+1)||(target&&target!==t))continue
  include.push({batch:i+1,target:t,runner:runners[t],entries:config.entries.slice(i*config.batchSize,(i+1)*config.batchSize)})
 }
 if(include.length>256)throw Error('Actions matrix exceeds 256 jobs')
 return {include}
}

export async function buildCandidate(entry,{sourceDir,workDir,tools,preparationError}={}){
 workDir=path.resolve(workDir);await mkdir(workDir,{recursive:true})
 const started=performance.now(),receipt={schemaVersion:1,repositoryId:entry.repositoryId,repository:entry.repository,commit:entry.commit,target:runtimeTarget(process.platform,process.arch),status:'failed',verification:'not-run',startedAt:new Date().toISOString(),steps:[]}
 const run=async(argv,cwd,env,label)=>{
  receipt.stage=label
  const result=await runCommand({argv,cwd,env,timeoutMs:label.startsWith('build')?480000:360000,logFile:path.join(workDir,`${receipt.steps.length}-${label}.log`)})
  receipt.steps.push({stage:label,argv,cwd:path.relative(workDir,cwd),logFile:path.relative(workDir,result.logFile),exitCode:result.exitCode,seconds:result.seconds})
  if(result.exitCode){const text=result.output.length>3200?`${result.output.slice(0,1600)}\n…\n${result.output.slice(-1600)}`:result.output;throw Error(`${label}: ${result.timedOut?'Command timed out. ':''}${text}`)}
  return result
 }
 try{
  assertCandidate(entry)
  receipt.adapterDigest=jsonDigest(entry)
  if(entry.error)throw Error(entry.error)
  if(preparationError)throw Error(preparationError)
  if(!/^[a-f0-9]{40}$/.test(entry.commit??''))throw Error('Missing frozen source commit')
  if(entry.prebuilt){
   receipt.stage='prebuilt'
   if(entry.prebuilt.sourceCommit!==entry.commit)throw Error('Prebuilt source commit does not match the frozen plan')
   const artifact=await importPrebuilt(entry,{workDir,target:receipt.target})
   receipt.artifact=artifact;receipt.artifacts=[artifact];receipt.package={name:artifact.name,version:artifact.version}
   receipt.dependencyMode='upstream-prebuilt';receipt.runtimeDependencies=Object.keys(artifact.runtimeDependencies)
   receipt.status='compiled'
  }else{
  if(!sourceDir){
   receipt.stage='source';sourceDir=path.join(workDir,'source')
   receipt.source=await acquireSource(entry,{workDir:path.join(workDir,'source-input'),directory:sourceDir,run,exclude:entry.sourceArchiveExcludes??[]})
   receipt.sourceSha256=receipt.source.sha256
  }
  receipt.stage='source-dependencies'
  receipt.sourceDependencies=await prepareSourceDependencies(entry,{sourceDir,workDir,run})
  receipt.stage='source-patches';receipt.sourcePatches=await applySourcePatches(entry,{sourceDir,target:receipt.target})
  const packageRoot=within(sourceDir,entry.packagePath),manifest=await readJson(path.join(packageRoot,'package.json'))
  if(entry.npmName&&manifest.name!==entry.npmName)throw Error('Package identity changed; review campaign config')
  receipt.package={name:manifest.name,version:manifest.version}
  const scripts=entry.buildScripts??[]
  if(scripts.some(s=>!manifest.scripts?.[s]))throw Error('Configured build script missing')
  const installRoot=within(sourceDir,entry.installPath??'.')
  const pnpm=entry.pnpmVersion||await exists(path.join(installRoot,'pnpm-lock.yaml'))||await exists(path.join(installRoot,'pnpm-workspace.yaml'))
  tools??=process.env.GITHUB_ACTIONS==='true'?await prepareTools({node:'26.9.0',npm:'11.19.1',...(pnpm?{pnpm:entry.pnpmVersion??'11.25.0'}:{})},path.join(workDir,'tools')):await resolveTools()
  const env=await isolatedEnv(path.join(workDir,'environment'),{bin:tools.bin})
  Object.assign(env,{HUSKY:'0',LEFTHOOK:'0',npm_config_ignore_scripts:'true',npm_config_manage_package_manager_versions:'false',npm_config_minimum_release_age:'0'})
  // Standalone projects must not borrow an ancestor's pnpm workspace or lock.
  if(!await exists(path.join(sourceDir,'pnpm-workspace.yaml')))env.npm_config_ignore_workspace='true'
  for(const [key,p]of Object.entries(entry.envPaths??{})){const resolved=within(sourceDir,p);await access(resolved);env[key]=resolved}
  receipt.stage='assets';receipt.assets=await prepareAssets(entry,{sourceDir,workDir,target:receipt.target})
  // Installation hooks stay off; only the reviewed scripts in the campaign run.
  if(scripts.length||entry.buildCommands?.length||entry.installPaths?.length){
   const manager=pnpm?'pnpm':'npm'
   receipt.dependencies=[]
   for(const [index,p]of [...new Set(entry.installPaths??[entry.installPath??'.'])].entries()){
    const root=within(sourceDir,p),usePnpm=entry.pnpmVersion||await exists(path.join(root,'pnpm-lock.yaml'))||await exists(path.join(root,'pnpm-workspace.yaml'))
    const manager=usePnpm?'pnpm':'npm',lockName=usePnpm?'pnpm-lock.yaml':'package-lock.json',locked=await exists(path.join(root,lockName))
    const frozen=locked&&entry.lockPolicy!=='refresh',sourceLockSha256=locked?await fileDigest(path.join(root,lockName)):undefined
    const args=usePnpm?['install',frozen?'--frozen-lockfile':'--no-frozen-lockfile','--ignore-scripts','--config.manage-package-manager-versions=false','--config.minimumReleaseAge=0']: [frozen?'ci':'install','--include=dev','--ignore-scripts','--legacy-peer-deps','--no-audit','--no-fund']
    if(!tools[manager])throw Error(`Missing dependency tool: ${manager}`)
    const workspaceArgs=usePnpm&&env.npm_config_ignore_workspace==='true'?['--ignore-workspace']:[]
    await run([...tools[manager],...workspaceArgs,...args],root,env,`dependencies-${index}`)
    if(index===0&&Object.keys(entry.buildDependencies??{}).length){
     const specs=Object.entries(entry.buildDependencies).map(([name,version])=>`${name}@${version}`)
     const add=usePnpm?['add','--save-dev','--save-exact','--ignore-scripts',...specs]:['install','--save-dev','--save-exact','--include=dev','--ignore-scripts','--legacy-peer-deps','--no-audit','--no-fund',...specs]
     await run([...tools[manager],...workspaceArgs,...add],root,env,'dependencies-adapter')
     receipt.buildDependencies=entry.buildDependencies
    }
    const lock=path.join(root,lockName),record={path:p,manager,sourceLockSha256,mode:(entry.buildDependencies&&index===0)||entry.lockPolicy==='refresh'?'adapter-resolution':locked?'source-lock':'trial-resolution'}
    if(await exists(lock)){
     record.sha256=await fileDigest(lock)
     const dest=path.join(workDir,'dependency-locks',String(index));await mkdir(dest,{recursive:true});await copyFile(lock,path.join(dest,lockName))
     if(index===0){receipt.lockSha256=record.sha256;await copyFile(lock,path.join(workDir,lockName))}
    }
    receipt.dependencies.push(record)
   }
   receipt.dependencyMode=receipt.dependencies[0]?.mode
   for(const script of scripts)await run([...tools[manager],...(pnpm&&env.npm_config_ignore_workspace==='true'?['--ignore-workspace']:[]),'run',script],installRoot,env,'build')
   for(const command of entry.buildCommands??[])await run(commandArgv(command.argv,tools),within(sourceDir,command.cwd??'.'),env,'build-command')
  }else receipt.dependencyMode='not-installed-prebuilt-trial'
  receipt.stage='pack'
  receipt.artifacts=await packCandidate(entry,{sourceDir,workDir,tools,env,run,pnpm})
  receipt.artifact=receipt.artifacts[0]
  receipt.runtimeDependencies=Object.keys(manifest.dependencies??{})
  receipt.status='compiled'
  }
 }catch(error){receipt.error=error.message;receipt.errorCategory=failureCategory(error.message,receipt.stage)}
 receipt.seconds=+((performance.now()-started)/1000).toFixed(3)
 await atomicJson(path.join(workDir,'receipt.json'),receipt)
 return receipt
}

export function failureCategory(message,stage=''){
 if(/timed out|timeout|aborted|fetch failed|ECONN|ENOTFOUND/i.test(message))return 'network'
 if(/OUTDATED_LOCKFILE|EUSAGE|lockfile.*not up to date/i.test(message))return 'dependency_lock'
 if(/Unknown option|Cannot locate .* CLI|Toolchain:/.test(message))return 'toolchain'
 if(/Archive download too large|components exceed/.test(message))return 'source_size'
 if(/Unsafe|Archive (?:link|path|member)|archive special|Cyclic archive|Duplicate archive|Case-colliding/.test(message))return 'source_archive'
 if(/checksum|identity|changed|pinned|frozen|SHA-256/i.test(message))return 'input_identity'
 if(/not valid JSON|JSON/.test(message))return 'tool_output'
 if(/Missing source submodule|source commit|DSH_CHECKOUT|Missing dependency tool|Configured build script/.test(message))return 'prerequisite'
 if(/dependencies/.test(stage))return 'dependencies'
 if(/source/.test(stage))return 'source_fetch'
 if(/prebuilt|assets/.test(stage))return 'artifact_input'
 if(/pack/.test(stage))return 'package_contents'
 return 'compile'
}

export function summarizeCampaign(plan,receipts){
 const found=new Map(),counts={compiled:0,failed:0,missing:0}
 const expected=new Set(plan.entries.flatMap(e=>plan.targets.map(t=>`${e.repositoryId}:${t}`)))
 for(const r of receipts){
  const key=`${r.repositoryId}:${r.target}`
  if(!expected.has(key))throw Error('Unexpected campaign receipt')
  if(found.has(key))throw Error('Duplicate campaign receipt')
  if(!['compiled','failed'].includes(r.status)||r.verification!=='not-run')throw Error('Invalid trial status')
  const entry=plan.entries.find(e=>e.repositoryId===r.repositoryId)
  if(entry.commit&&r.commit!==entry.commit)throw Error('Receipt source differs from frozen plan')
  if(r.adapterDigest&&r.adapterDigest!==jsonDigest(entry))throw Error('Receipt adapter differs from frozen plan')
  found.set(key,r)
 }
 const plugins=plan.entries.map(e=>{
  const results=Object.fromEntries(plan.targets.map(target=>{
   const r=found.get(`${e.repositoryId}:${target}`)??{target,status:'missing'}
   counts[r.status]++;return [target,r]
  }))
  return {...e,results,compiled:Object.values(results).every(r=>r.status==='compiled')}
 })
 const failureTypes={}
 for(const r of receipts)if(r.status==='failed'){const category=r.errorCategory??failureCategory(r.error??'');failureTypes[category]=(failureTypes[category]??0)+1}
 return {schemaVersion:1,campaign:plan.id,verification:'not-run',counts,failureTypes,plugins}
}

const cell=text=>String(text??'').replace(/[\r\n|<>`]/g,' ').slice(0,80)
export function campaignMarkdown(report,runUrl){
 const labels={compiled:'产物就绪（未离线验证）',failed:'失败',missing:'未收到结果'}
 const rows=report.plugins.map((p,i)=>{
  const states=Object.entries(p.results).map(([t,r])=>`${t}: ${labels[r.status]}${r.error?` [${r.errorCategory??failureCategory(r.error)}] — ${cell(r.error)}`:''}`).join('；')
  return `- [${p.compiled?'x':' '}] ${i+1}. [${p.repository}](https://github.com/${p.repository}) · ${p.commit?.slice(0,8)??'未解析版本'} · ${states}`
 })
 return `<!-- candidate-build:start -->\n## 99 个热门插件：三平台试编译\n\n[本次 Actions](${runUrl}) · 产物就绪 ${report.counts.compiled} / 失败 ${report.counts.failed} / 缺失 ${report.counts.missing}（平台任务数）\n\n勾选仅表示该仓库在本次选择的平台已完成源码编译打包或固定成品包检查；尚未进行原版 DSH 断网安装验证，不能视为可发布的离线成品。试编译包、依赖锁和日志见 Actions artifacts。\n\n${rows.join('\n')}\n<!-- candidate-build:end -->`
}
