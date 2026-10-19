// Trial compilation only. These receipts cannot enter the release publisher.
import path from 'node:path'
import {mkdir, access, copyFile} from 'node:fs/promises'
import {downloadArchive, extractArchive} from './build.mjs'
import {readJson, atomicJson, fileDigest, within} from './model.mjs'
import {isolatedEnv, runCommand, resolveTools, prepareTools} from './process.mjs'
import {runtimeTarget} from './platform.mjs'

const runners={'macos-arm64':'macos-15','linux-x64':'ubuntu-24.04','win32-x64':'windows-2025'}
const exists=async file=>{try{await access(file);return true}catch{return false}}
export function campaignMatrix(config,{batch,target}={}){
 if(!Number.isInteger(config.batchSize)||config.batchSize<1||config.batchSize>5)throw Error('Invalid batch size')
 const ids=new Set(),repos=new Set()
 for(const e of config.entries){
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

export async function buildCandidate(entry,{sourceDir,workDir,tools}={}){
 workDir=path.resolve(workDir);await mkdir(workDir,{recursive:true})
 const started=performance.now(),receipt={schemaVersion:1,repositoryId:entry.repositoryId,repository:entry.repository,commit:entry.commit,target:runtimeTarget(process.platform,process.arch),status:'failed',verification:'not-run',startedAt:new Date().toISOString(),steps:[]}
 const run=async(argv,cwd,env,label)=>{
  const result=await runCommand({argv,cwd,env,timeoutMs:label==='build'?480000:360000,logFile:path.join(workDir,`${receipt.steps.length}-${label}.log`)})
  receipt.steps.push({stage:label,argv,exitCode:result.exitCode,seconds:result.seconds})
  if(result.exitCode)throw Error(`${label}: ${result.output.slice(-2500)}`)
  return result
 }
 try{
  if(entry.error)throw Error(entry.error)
  if(!/^[a-f0-9]{40}$/.test(entry.commit??''))throw Error('Missing frozen source commit')
  if(!sourceDir){
   const archive=path.join(workDir,'source.tgz')
   await downloadArchive(`https://codeload.github.com/${entry.repository}/tar.gz/${entry.commit}`,archive)
   receipt.sourceSha256=await fileDigest(archive)
   sourceDir=await extractArchive(archive,path.join(workDir,'source'))
  }
  const packageRoot=within(sourceDir,entry.packagePath),manifest=await readJson(path.join(packageRoot,'package.json'))
  if(entry.npmName&&manifest.name!==entry.npmName)throw Error('Package identity changed; review campaign config')
  receipt.package={name:manifest.name,version:manifest.version}
  const scripts=entry.buildScripts??[]
  if(scripts.some(s=>!manifest.scripts?.[s]))throw Error('Configured build script missing')
  const installRoot=within(sourceDir,entry.installPath??'.')
  const pnpm=entry.pnpmVersion||await exists(path.join(installRoot,'pnpm-lock.yaml'))||await exists(path.join(installRoot,'pnpm-workspace.yaml'))
  tools??=process.env.GITHUB_ACTIONS==='true'?await prepareTools({node:'26.9.0',npm:'11.19.1',...(pnpm?{pnpm:entry.pnpmVersion??'11.25.0'}:{})},path.join(workDir,'tools')):await resolveTools()
  const env=await isolatedEnv(path.join(workDir,'environment'),{bin:tools.bin})
  env.HUSKY='0';env.LEFTHOOK='0'
  // Installation hooks stay off; only the reviewed scripts in the campaign run.
  if(scripts.length){
   const manager=pnpm?'pnpm':'npm',locked=await exists(path.join(installRoot,pnpm?'pnpm-lock.yaml':'package-lock.json'))
   receipt.dependencyMode=locked?'source-lock':'trial-resolution'
   const args=pnpm?['install',locked?'--frozen-lockfile':'--no-frozen-lockfile','--ignore-scripts','--config.manage-package-manager-versions=false','--config.minimumReleaseAge=0']: [locked?'ci':'install','--ignore-scripts','--legacy-peer-deps','--no-audit','--no-fund']
   await run([...tools[manager],...args],installRoot,env,'dependencies')
   const lock=path.join(installRoot,pnpm?'pnpm-lock.yaml':'package-lock.json')
   if(await exists(lock)){receipt.lockSha256=await fileDigest(lock);await copyFile(lock,path.join(workDir,path.basename(lock)))}
   for(const script of scripts)await run([...tools[manager],'run',script],installRoot,env,'build')
  }else receipt.dependencyMode='not-installed-prebuilt-trial'
  const output=path.join(workDir,'packages');await mkdir(output,{recursive:true})
  const packed=await run([...tools.npm,'pack','--ignore-scripts','--json','--pack-destination',output],packageRoot,env,'pack')
  const pack=JSON.parse(packed.output)[0],files=new Set(pack.files.map(f=>f.path))
  const patch=manifest.dsh?.bundle?.patch
  if(typeof patch!=='string'||!files.has(patch.replace(/^\.\//,'')))throw Error('Packed package is missing its DSH bundle patch')
  if(manifest.main&&!files.has(manifest.main.replace(/^\.\//,'')))throw Error(`Packed package is missing main: ${manifest.main}`)
  const file=path.join(output,path.basename(pack.filename))
  receipt.artifact={file,filename:path.basename(file),bytes:pack.size,sha256:await fileDigest(file)}
  receipt.runtimeDependencies=Object.keys(manifest.dependencies??{})
  receipt.status='compiled'
 }catch(error){receipt.error=error.message}
 receipt.seconds=+((performance.now()-started)/1000).toFixed(3)
 await atomicJson(path.join(workDir,'receipt.json'),receipt)
 return receipt
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
  found.set(key,r)
 }
 const plugins=plan.entries.map(e=>{
  const results=Object.fromEntries(plan.targets.map(target=>{
   const r=found.get(`${e.repositoryId}:${target}`)??{target,status:'missing'}
   counts[r.status]++;return [target,r]
  }))
  return {...e,results,compiled:Object.values(results).every(r=>r.status==='compiled')}
 })
 return {schemaVersion:1,campaign:plan.id,verification:'not-run',counts,plugins}
}

const cell=text=>String(text??'').replace(/[\r\n|<>`]/g,' ').slice(0,80)
export function campaignMarkdown(report,runUrl){
 const labels={compiled:'编译打包通过（未离线验证）',failed:'失败',missing:'未收到结果'}
 const rows=report.plugins.map((p,i)=>{
  const states=Object.entries(p.results).map(([t,r])=>`${t}: ${labels[r.status]}${r.error?` — ${cell(r.error)}`:''}`).join('；')
  return `- [${p.compiled?'x':' '}] ${i+1}. [${p.repository}](https://github.com/${p.repository}) · ${p.commit?.slice(0,8)??'未解析版本'} · ${states}`
 })
 return `<!-- candidate-build:start -->\n## 99 个热门插件：三平台试编译\n\n[本次 Actions](${runUrl}) · 编译打包通过 ${report.counts.compiled} / 失败 ${report.counts.failed} / 缺失 ${report.counts.missing}（平台任务数）\n\n勾选仅表示该仓库在本次选择的平台全部编译并打包通过；尚未进行原版 DSH 断网安装验证，不能视为可发布的离线成品。试编译包、依赖锁和日志见 Actions artifacts。\n\n${rows.join('\n')}\n<!-- candidate-build:end -->`
}
