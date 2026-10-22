// Publish existing trial bytes as individual public assets. Never execute them.
import path from 'node:path'
import {mkdir,readdir,writeFile,stat,rm} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import {setTimeout as delay} from 'node:timers/promises'
import {Github} from './lib/github.mjs'
import {readJson,atomicJson,fileDigest,jsonDigest,digest,within} from './lib/model.mjs'
import {extractArchive} from './lib/build.mjs'
import {summarizeCampaign} from './lib/candidate-build.mjs'
import {githubReleaseRemote} from './lib/publish.mjs'

const repository='fatevase/dsh_depot',workflow='.github/workflows/candidate-builds.yml'
const targets=['macos-arm64','linux-x64','win32-x64']
async function unpack(github,artifact,directory){
 if(!artifact||artifact.expired)throw Error('Required build artifact is unavailable')
 await mkdir(directory,{recursive:true})
 const zip=path.join(directory,'artifact.zip')
 await github.download(`/repos/${repository}/actions/artifacts/${artifact.id}/zip`,zip)
 if(artifact.digest&&artifact.digest!==`sha256:${await fileDigest(zip)}`)throw Error('Build artifact digest mismatch')
 await extractArchive(zip,path.join(directory,'contents'),{strip:0})
 return path.join(directory,'contents')
}
export async function publishCandidateDownloads({github,runId,workDir}){
 const meta=(await github.request(`/repos/${repository}`)).data
 const candidates=runId?[(await github.request(`/repos/${repository}/actions/runs/${runId}`)).data]
  :(await github.request(`/repos/${repository}/actions/workflows/candidate-builds.yml/runs?status=completed&branch=${meta.default_branch}&per_page=30`)).data.workflow_runs
 let chosen
 for(const run of candidates){
  if(run.path!==workflow||run.head_repository?.id!==meta.id||run.head_branch!==meta.default_branch||run.status!=='completed'||!['push','workflow_dispatch','schedule'].includes(run.event))continue
  const artifacts=(await github.request(`/repos/${repository}/actions/runs/${run.id}/artifacts?per_page=100`)).data.artifacts
  if(!artifacts.some(a=>a.name==='candidate-build-report'&&!a.expired)||!artifacts.some(a=>a.name==='candidate-build-plan'&&!a.expired))continue
  const jobs=(await github.request(`/repos/${repository}/actions/runs/${run.id}/jobs?per_page=100&filter=latest`)).data.jobs
  if(!jobs.some(j=>j.name==='report'&&j.conclusion==='success'))continue
  const dir=path.join(workDir,String(run.id)),planDir=await unpack(github,artifacts.find(a=>a.name==='candidate-build-plan'),path.join(dir,'plan'))
  const plan=await readJson(path.join(planDir,'plan.json')),config=await readJson(new URL('./candidate-builds.json',import.meta.url))
  if(!plan.entries.length||!plan.targets?.length||plan.targets.some(t=>!targets.includes(t))){await rm(dir,{recursive:true,force:true});continue}
  if(plan.sourceCommit!==run.head_sha||plan.id!==config.id||new Set(plan.entries.map(e=>e.repositoryId)).size!==plan.entries.length||plan.entries.some(p=>!config.entries.some(e=>p.repositoryId===e.repositoryId&&p.repository.toLowerCase()===e.repository.toLowerCase())))throw Error('Candidate plan identity mismatch')
  chosen={run,artifacts,plan,dir};break
 }
 if(!chosen){if(runId)return{runId,packages:0,reason:'No publishable candidate report in this run'};throw Error('No completed main-branch candidate report is available')}
 const {run,artifacts,plan,dir}=chosen,receipts=[],locations=new Map()
 for(const artifact of artifacts.filter(a=>/^candidate-batch-\d+-(macos-arm64|linux-x64|win32-x64)$/.test(a.name))){
  if(artifact.expired)throw Error('Candidate package artifact expired; rebuild required')
  const root=await unpack(github,artifact,path.join(dir,artifact.name))
  async function collect(directory){for(const e of await readdir(directory,{withFileTypes:true})){
   const file=path.join(directory,e.name)
   if(e.isDirectory())await collect(file)
   else if(e.name==='receipt.json'){
    const receipt=await readJson(file),key=`${receipt.repositoryId}:${receipt.target}`
    if(locations.has(key))throw Error('Duplicate candidate receipt')
    locations.set(key,path.dirname(file));receipts.push(receipt)
   }
  }}
  await collect(root)
 }
 const report=summarizeCampaign(plan,receipts),packages=[],names=new Set()
 for(const entry of report.plugins)for(const target of plan.targets){
  const receipt=entry.results[target]
  if(receipt.status!=='compiled')continue
  const frozen=plan.entries.find(e=>e.repositoryId===entry.repositoryId)
  if(receipt.adapterDigest!==jsonDigest(frozen))throw Error('Compiled receipt has no matching frozen adapter')
  if(!receipt.artifacts?.length)throw Error('Compiled receipt has no package files')
  for(const a of receipt.artifacts){
   if(!/^[A-Za-z0-9._+-]+\.tgz$/.test(a.filename??'')||!/^([a-f0-9]{64})$/.test(a.sha256??'')||!Number.isSafeInteger(a.bytes)||a.bytes<1||a.bytes>=2147483648)throw Error('Invalid candidate package metadata')
   const file=within(locations.get(`${entry.repositoryId}:${target}`),`packages/${a.filename}`)
   if(!(await stat(file)).isFile()||(await stat(file)).size!==a.bytes||await fileDigest(file)!==a.sha256)throw Error('Candidate package bytes differ from receipt')
   const assetName=`${entry.repositoryId}-${a.filename.slice(0,-4)}-${target}.tgz`
   if(assetName.length>240||names.has(assetName))throw Error('Candidate download filename collision')
   names.add(assetName)
   packages.push({repositoryId:entry.repositoryId,repository:entry.repository,sourceCommit:entry.commit,target,name:a.name,version:a.version,filename:a.filename,assetName,sha256:a.sha256,bytes:a.bytes,kind:a.kind,file})
  }
 }
 if(!packages.length)return {runId:run.id,packages:0,reason:'No completed packages in this batch'}
 packages.sort((a,b)=>a.assetName.localeCompare(b.assetName))
 const tag=`candidate-${run.id}-${run.run_attempt}`,base=`/repos/${repository}`,remote=githubReleaseRemote({repository,github})
 let release
 try{release=(await github.request(`${base}/releases/tags/${tag}`)).data}catch(e){if(e.status!==404)throw e
  release=(await github.request(`${base}/releases`,{method:'POST',body:{tag_name:tag,target_commitish:run.head_sha,name:`DSH 插件构建包（未离线验证） · ${run.id}`,draft:true,prerelease:true,body:'每个文件对应一个插件、版本和平台，直接下载 .tgz；无需下载整批 Actions ZIP。\n\n仅完成编译打包或上游成品检查，尚未进行离线安装及运行验证。构建成功不表示运行依赖已经齐全。candidate-downloads.json 记录来源和校验值。\n\n构建记录：https://github.com/'+repository+'/actions/runs/'+run.id}})).data
 }
 if(!release.prerelease)throw Error('Candidate release must remain a prerelease')
 const existing=new Map((await github.list(`${base}/releases/${release.id}/assets`)).map(a=>[a.name,a]))
 const url=name=>`https://github.com/${repository}/releases/download/${tag}/${encodeURIComponent(name)}`
 async function upload(name,file,sha){
  const old=existing.get(name)
  if(old){if(old.digest!==`sha256:${sha}`)throw Error('Immutable candidate asset checksum conflict');return}
  if(!release.draft)throw Error('Public candidate release is incomplete; use a new run attempt')
  for(let attempt=0;attempt<3;attempt++){
   try{const result=await remote.upload(release,name,file,sha);if(result.sha256!==sha)throw Error('Uploaded candidate checksum mismatch');return}
   catch(error){
    if(attempt===2)throw error
    await delay(5000*(attempt+1))
    const found=(await github.list(`${base}/releases/${release.id}/assets`)).find(a=>a.name===name)
    if(found){if(found.digest!==`sha256:${sha}`)throw Error('Immutable candidate asset checksum conflict');return}
   }
  }
 }
 for(let offset=0;offset<packages.length;offset+=4){
  await Promise.all(packages.slice(offset,offset+4).map(p=>upload(p.assetName,p.file,p.sha256)))
  console.log(JSON.stringify({uploaded:Math.min(offset+4,packages.length),total:packages.length}))
  if(offset+4<packages.length)await delay(4000)
 }
 const manifest={schemaVersion:1,runId:run.id,runAttempt:run.run_attempt,sourceCommit:run.head_sha,verification:'not-run',releaseTag:tag,counts:report.counts,packages:packages.map(({file,...p})=>({...p,url:url(p.assetName)}))}
 const data=Buffer.from(JSON.stringify(manifest,null,2)+'\n'),sums=Buffer.from(packages.map(p=>`${p.sha256}  ${p.assetName}`).join('\n')+'\n')
 await upload('candidate-downloads.json',data,digest(data));await upload('SHA256SUMS',sums,digest(sums))
 await remote.publish(release)
 for(let attempt=0;;attempt++){try{await remote.assertPublicDownloads([url('candidate-downloads.json'),url(packages[0].assetName),url(packages.at(-1).assetName)]);break}catch(error){if(attempt>=2)throw error;await delay(3000)}}
 await atomicJson(path.join(workDir,'published.json'),manifest)
 return {runId:run.id,releaseTag:tag,packages:packages.length,catalogUrl:url('candidate-downloads.json')}
}
export async function main(env=process.env){
 if(env.GITHUB_REPOSITORY!==repository||env.GITHUB_REF!=='refs/heads/main')throw Error('Candidate download publication is restricted to this repository main branch')
 const event=await readJson(env.GITHUB_EVENT_PATH),runId=env.GITHUB_EVENT_NAME==='workflow_run'?event.workflow_run?.id:env.CANDIDATE_RUN_ID?Number(env.CANDIDATE_RUN_ID):undefined
 if(runId!==undefined&&(!Number.isSafeInteger(runId)||runId<1))throw Error('Invalid source run')
 return publishCandidateDownloads({github:new Github({token:env.GITHUB_TOKEN}),runId,workDir:path.resolve('.runtime/candidate-downloads')})
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().then(r=>console.log(JSON.stringify(r)),e=>{console.error(e.message);process.exitCode=1})
