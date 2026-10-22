import { supportedTarget } from './platform.mjs'
import metadata from '../metadata.json' with { type: 'json' }
import config from '../config.json' with { type: 'json' }
import pluginList from '../plugin-list.json' with { type: 'json' }
import { readFile } from 'node:fs/promises'
import { fileDigest, digest, jsonDigest, buildKey } from './model.mjs'
import { assertVerification } from './verify.mjs'
import { mergeState } from './state.mjs'
import assert from 'node:assert/strict'
export function publicationChannelOf(r,recipe,{allowUnverified=false}={}){
  if(r.status==='verified'){assertVerification(r.verification,r,r.artifacts?.sha256,recipe);return 'verified'}
  const v=r.verification
  assert.ok(allowUnverified,'Unverified publication is disabled')
  assert.equal(r.stage,'verify');assert.ok(['unverified','failed'].includes(r.status));assert.equal(v?.status,r.status)
  assert.equal(v.schemaVersion,1);assert.equal(v.buildKey,r.buildKey);assert.equal(v.target,r.target);assert.deepEqual(v.host,r.host);assert.equal(v.sha256,r.artifacts?.sha256)
  assert.match(r.artifacts?.sha256??'',/^[a-f0-9]{64}$/);assert.ok(v.error?.message,'Missing verification failure reason')
  assert.ok(r.artifacts?.compressedBytes>0&&r.artifacts?.unpackedBytes>0,'Missing completed build artifact')
  return 'unverified'
}
export function catalogOf(state, recipes = []) {
  const selected = new Set(recipes.filter(r=>r.enabled||r.blockedReason).map(r=>r.id))
  const currentInput=p=>{const r=recipes.find(r=>r.id===p.recipeId);return !r?.latestOnly||(!r.latestRefreshError&&p.host?.version===config.host.version&&p.version===r.seed?.version&&p.source?.commit===r.seed?.commit)}
  const packages = Object.values(state.published).filter(p => currentInput(p) && selected.has(p.recipeId) && p.status === 'published' && supportedTarget(p.target) && !state.withdrawn[p.buildKey]).map(p=>({...p,toolchain:p.toolchain??state.receipts?.[p.buildKey]?.toolchain,sourceArchiveSha256:p.sourceArchiveSha256??state.receipts?.[p.buildKey]?.sourceArchiveSha256,timings:p.timings??state.receipts?.[p.buildKey]?.timings}))
  const keys = new Set(packages.map(p=>p.buildKey))
  const latest = Object.fromEntries(Object.entries(state.latest).filter(([,key])=>keys.has(key)))
  return { schemaVersion: 1, host:config.host, cohort:config.cohort, decisions:(state.lastPlan?.decisions??[]).filter(d=>selected.has(d.recipeId)&&(!d.target||supportedTarget(d.target))), distributionRepository:config.distributionRepository, lastSuccessfulDiscoveryAt: state.lastSuccessfulDiscoveryAt, batch:state.lastPlan?.batch, latest, packages, plugins: recipes.filter(r=>r.enabled||r.blockedReason).sort((a,b)=>(metadata[a.id]?.order??99)-(metadata[b.id]?.order??99)).map(r=>({id:r.id,upstreamUpdatedAt:state.repositoryMetadata?.[r.repository.toLowerCase()]?.pushedAt??pluginList.candidates.find(c=>c.repository.toLowerCase()===r.repository.toLowerCase())?.pushedAt,upstreamObservedAt:state.repositoryMetadata?.[r.repository.toLowerCase()]?.observedAt??pluginList.candidates.find(c=>c.repository.toLowerCase()===r.repository.toLowerCase())?.observedAt,name:r.display?.name ?? r.id,npmName:r.npmName,repository:r.repository,category:r.display?.category ?? 'tools',description:metadata[r.id]?.description ?? '',label:metadata[r.id]?.label,mark:metadata[r.id]?.mark,license:metadata[r.id]?.license??r.license,seed:r.seed,latestOnly:r.latestOnly,latestRefreshError:r.latestRefreshError,targets:r.targets,status:r.enabled?'curated':'needs_recipe',blockedReason:r.blockedReason,availabilityNote:metadata[r.id]?.availabilityNote,distributionScope:r.distributionScope})), issues: Object.values(state.receipts).filter(r=>selected.has(r.recipeId)&&supportedTarget(r.target)&&['failed','unverified','missing'].includes(r.status)).map(r=>({recipeId:r.recipeId,target:r.target,buildKey:r.buildKey,stage:r.stage,status:r.status,attempt:r.attempt,version:r.source?.version,error:r.error})) }
}
export async function publishBatch({ batchId, repository, state, receipts, remote, github, dryRun = true, recipes = [], tasks = [], allowUnverified = false }) {
  if (!/^[\w.-]+$/.test(String(batchId))) throw new Error('Invalid batch ID')
  if (!dryRun && !/^[\w.-]+\/[\w.-]+$/.test(repository ?? '')) throw new Error('Real publication requires an explicit repository')
  const actions = [], accepted = [], counts = new Map()
  for(const r of receipts)counts.set(r.buildKey,(counts.get(r.buildKey)??0)+1)
  for (const r of receipts) {
    try {
      const task=tasks.find(t=>t.buildKey===r.buildKey),recipe=recipes.find(p=>p.id===r.recipeId)
      if(counts.get(r.buildKey)!==1||!task||!recipe)throw new Error('Receipt key is duplicate or absent from approved plan/recipes')
      for(const field of ['recipeId','recipeDigest','source','host','target','plannedAt'])if(jsonDigest(r[field])!==jsonDigest(task[field]))throw new Error(`Receipt ${field} differs from approved plan`)
      if(task.recipeDigest!==jsonDigest(recipe)||buildKey({recipe,source:task.source,target:task.target,host:task.host})!==task.buildKey)throw new Error('Approved build inputs changed')
      if (state.withdrawn[r.buildKey]) throw new Error('Explicitly withdrawn')
      const channel=publicationChannelOf(r,recipe,{allowUnverified})
      if (await fileDigest(r.artifacts.package) !== r.artifacts.sha256) throw new Error('Package checksum changed after verification')
      const old = state.published[r.buildKey]
      if (old) { if (old.sha256 !== r.artifacts.sha256) throw new Error('Immutable key checksum conflict'); if(old.presentationVersion===2&&(old.publicationChannel??'verified')===channel){actions.push({buildKey:r.buildKey,action:'skip',reason:'Already published'});continue} }
      accepted.push(r);actions.push({buildKey:r.buildKey,action:dryRun?'would_publish':'publish'})
    } catch(error) { actions.push({buildKey:r.buildKey,action:'rejected',reason:error.message}) }
  }
  let publications = []
  if (!dryRun && accepted.length) {
    remote ??= githubReleaseRemote({ repository, github })
    const tag = `depot-${batchId}`, release = await remote.ensureDraft(tag,{packages:accepted.map(r=>({fileName:packageFileName(r),channel:publicationChannelOf(r,recipes.find(p=>p.id===r.recipeId),{allowUnverified})}))})
    if(release.tag_name&&release.tag_name!==tag)throw Error('Release tag differs from publication batch')
    const publicUrl=name=>`https://github.com/${repository}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(name)}`
    const named=accepted.map(receipt=>({receipt,name:packageFileName(receipt)}))
    if(new Set(named.map(p=>p.name)).size!==named.length)throw Error('Package filenames collide within a release')
    async function upload(name,file){
      const sha=Buffer.isBuffer(file)?digest(file):await fileDigest(file)
      let asset=await remote.asset(release,name)
      if(asset&&asset.sha256!==sha)throw Error(`Immutable asset checksum conflict: ${name}`)
      if(!asset){if(!release.draft)throw Error('Public release missing an asset; use a new batch ID');asset=await remote.upload(release,name,file,sha)}
      if(asset.sha256!==sha)throw Error('Uploaded asset checksum mismatch')
      return publicUrl(name)
    }
    for(const {receipt,name} of named)await upload(name,receipt.artifacts.package)
    const ordered=[...named].sort((a,b)=>a.name.localeCompare(b.name))
    const sums=Buffer.from(ordered.map(({receipt,name})=>`${receipt.artifacts.sha256}  ${name}\n`).join(''))
    const reports=Buffer.from(JSON.stringify({schemaVersion:1,releaseTag:tag,packages:ordered.map(({receipt:r,name})=>{
      const verification={...r.verification};delete verification.workDir
      const manifest=r.artifacts.manifest??{}
      return {fileName:name,buildKey:r.buildKey,publicationChannel:publicationChannelOf(r,recipes.find(p=>p.id===r.recipeId),{allowUnverified}),sha256:r.artifacts.sha256,recipeId:r.recipeId,source:r.source,host:r.host,target:r.target,recipeDigest:r.recipeDigest,sourceArchiveSha256:r.sourceArchiveSha256,toolchain:recipes.find(p=>p.id===r.recipeId)?.toolchain,timings:r.timings,dependencies:{required:manifest.dependencies??{},optional:manifest.optionalDependencies??{},hostPeers:manifest.peerDependencies??{},bundled:manifest.bundleDependencies??[]},verification}
    })},null,2)+'\n')
    const checksumsUrl=await upload('SHA256SUMS',sums),reportUrl=await upload('reports.json',reports)
    await remote.publish(release)
    await remote.assertPublicDownloads?.([...named.map(p=>publicUrl(p.name)),checksumsUrl,reportUrl])
    for(const {receipt:r,name} of named){const verification={...r.verification};delete verification.workDir
      publications.push({buildKey:r.buildKey,publicationChannel:publicationChannelOf(r,recipes.find(p=>p.id===r.recipeId),{allowUnverified}),recipeId:r.recipeId,version:r.source.version,source:r.source,host:r.host,target:r.target,status:'published',toolchain:recipes.find(p=>p.id===r.recipeId)?.toolchain,timings:r.timings,sourceArchiveSha256:r.sourceArchiveSha256,dependencies:{required:r.artifacts.manifest?.dependencies??{},optional:r.artifacts.manifest?.optionalDependencies??{},bundled:r.artifacts.manifest?.bundleDependencies??[]},sha256:r.artifacts.sha256,compressedBytes:r.artifacts.compressedBytes,unpackedBytes:r.artifacts.unpackedBytes,packageUrl:publicUrl(name),reportUrl,assets:{package:publicUrl(name),checksums:checksumsUrl,reports:reportUrl},verification,fileName:name,presentationVersion:2,releaseTag:tag,plannedAt:r.plannedAt,publishedAt:state.published[r.buildKey]?.publishedAt??new Date().toISOString()})
    }
  }
  const next = mergeState(state,{receipts,publications})
  return {schemaVersion:1,dryRun,batchId,actions,publications,state:next,catalog:catalogOf(next,recipes)}
}
export function packageFileName(receipt){
 const {recipeId,source,target}=receipt
 if(!/^[a-z0-9][a-z0-9-]*$/.test(recipeId??'')||!/^[0-9A-Za-z.+-]+$/.test(source?.version??'')||!supportedTarget(target))throw Error('Invalid public package identity')
 return `${recipeId}-${source.version}-${target}.tgz`
}
export function githubReleaseRemote({ repository, github }) {
  const base=`/repos/${repository}`
  async function checked(asset){let sha256=asset.digest?.replace(/^sha256:/,'');if(!sha256){const r=await fetch(github.baseUrl+base+`/releases/assets/${asset.id}`,{headers:{accept:'application/octet-stream',...(github.token?{authorization:`Bearer ${github.token}`}:{})},signal:AbortSignal.timeout(120000)});if(!r.ok)throw Error('Cannot verify remote asset');sha256=digest(Buffer.from(await r.arrayBuffer()))}return{sha256,url:asset.browser_download_url}}
  return {
    async ensureDraft(tag,{packages=[]}={}){try{return(await github.request(base+`/releases/tags/${tag}`)).data}catch(e){if(e.status!==404)throw e;return(await github.request(base+'/releases',{method:'POST',body:{tag_name:tag,name:`DSH 插件离线包${packages.length&&packages.every(p=>p.channel==='unverified')?'（未验证）':''} · ${new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())}`,body:'安装包命名：插件-版本-平台.tgz。SHA256SUMS 为校验清单，reports.json 包含源码、依赖和验证记录。标记为 unverified 的包已完成打包，但离线安装或运行验证未通过；请先在插件详情查看原因，再决定是否下载。\n\n安装与版本说明：https://fatevase.github.io/dsh_depot/guide.html\n\n'+packages.map(p=>`- ${p.fileName}：${p.channel==='verified'?'验证通过':'未验证，离线安装或运行检查未通过；详情见网站与 reports.json'}`).join('\n'),draft:true,prerelease:packages.length>0&&packages.every(p=>p.channel==='unverified')}})).data}},
    async asset(release,name){const assets=await github.list(base+`/releases/${release.id}/assets`);const a=assets.find(a=>a.name===name);return a?checked(a):null},
    async upload(release,name,file,sha){const bytes=Buffer.isBuffer(file)?file:await readFile(file),url=new URL(release.upload_url.split('{')[0]);if(url.hostname!=='uploads.github.com')throw Error('Unexpected upload origin');url.searchParams.set('name',name);const r=await fetch(url,{method:'POST',headers:{authorization:`Bearer ${github.token}`,'content-type':'application/octet-stream'},body:bytes,signal:AbortSignal.timeout(120000)});if(!r.ok)throw Error(`Asset upload HTTP ${r.status}`);return checked(await r.json())},
    async assertPublicDownloads(urls){for(const url of urls){const response=await fetch(url,{method:'HEAD',redirect:'follow',signal:AbortSignal.timeout(30000)});if(!response.ok)throw Error(`Published download returned HTTP ${response.status}: ${new URL(url).pathname}`)}},
    async publish(release){if(release.draft)await github.request(base+`/releases/${release.id}`,{method:'PATCH',body:{draft:false}})}
  }
}
