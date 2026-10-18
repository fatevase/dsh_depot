import metadata from '../metadata.json' with { type: 'json' }
import config from '../config.json' with { type: 'json' }
import { readFile } from 'node:fs/promises'
import { fileDigest, digest, jsonDigest, buildKey } from './model.mjs'
import { assertVerification } from './verify.mjs'
import { mergeState } from './state.mjs'
export function catalogOf(state, recipes = []) {
  const selected = new Set(recipes.filter(r=>r.enabled||r.blockedReason).map(r=>r.id))
  const packages = Object.values(state.published).filter(p => selected.has(p.recipeId) && p.status === 'published' && !state.withdrawn[p.buildKey])
  const keys = new Set(packages.map(p=>p.buildKey))
  const latest = Object.fromEntries(Object.entries(state.latest).filter(([,key])=>keys.has(key)))
  return { schemaVersion: 1, host:config.host, cohort:config.cohort, decisions:(state.lastPlan?.decisions??[]).filter(d=>selected.has(d.recipeId)), distributionRepository:config.distributionRepository, lastSuccessfulDiscoveryAt: state.lastSuccessfulDiscoveryAt, latest, packages, plugins: recipes.filter(r=>r.enabled||r.blockedReason).sort((a,b)=>(metadata[a.id]?.order??99)-(metadata[b.id]?.order??99)).map(r=>({id:r.id,name:r.display?.name ?? r.id,npmName:r.npmName,repository:r.repository,category:r.display?.category ?? 'tools',description:metadata[r.id]?.description ?? '',label:metadata[r.id]?.label,mark:metadata[r.id]?.mark,license:metadata[r.id]?.license??r.license,seed:r.seed,targets:r.targets,status:r.enabled?'curated':'needs_recipe',blockedReason:r.blockedReason,availabilityNote:metadata[r.id]?.availabilityNote,distributionScope:r.distributionScope})), issues: Object.values(state.receipts).filter(r=>selected.has(r.recipeId)&&['failed','unverified','missing'].includes(r.status)).map(r=>({recipeId:r.recipeId,target:r.target,status:r.status,error:r.error})) }
}
export async function publishBatch({ batchId, repository, state, receipts, remote, github, dryRun = true, recipes = [], tasks = [] }) {
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
      if (r.status !== 'verified' || state.withdrawn[r.buildKey]) throw new Error('Not verified or explicitly withdrawn')
      assertVerification(r.verification, r, r.artifacts.sha256,recipe)
      if (await fileDigest(r.artifacts.package) !== r.artifacts.sha256) throw new Error('Package checksum changed after verification')
      const old = state.published[r.buildKey]
      if (old) { if (old.sha256 !== r.artifacts.sha256) throw new Error('Immutable key checksum conflict'); if(old.presentationVersion===2){actions.push({buildKey:r.buildKey,action:'skip',reason:'Already published'});continue} }
      accepted.push(r);actions.push({buildKey:r.buildKey,action:dryRun?'would_publish':'publish'})
    } catch(error) { actions.push({buildKey:r.buildKey,action:'rejected',reason:error.message}) }
  }
  let publications = []
  if (!dryRun && accepted.length) {
    remote ??= githubReleaseRemote({ repository, github })
    const tag = `depot-${batchId}`, release = await remote.ensureDraft(tag)
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
      return {fileName:name,buildKey:r.buildKey,sha256:r.artifacts.sha256,recipeId:r.recipeId,source:r.source,host:r.host,target:r.target,recipeDigest:r.recipeDigest,sourceArchiveSha256:r.sourceArchiveSha256,toolchain:recipes.find(p=>p.id===r.recipeId)?.toolchain,timings:r.timings,dependencies:{required:manifest.dependencies??{},optional:manifest.optionalDependencies??{},hostPeers:manifest.peerDependencies??{},bundled:manifest.bundleDependencies??[]},verification}
    })},null,2)+'\n')
    const checksumsUrl=await upload('SHA256SUMS',sums),reportUrl=await upload('reports.json',reports)
    await remote.publish(release)
    await remote.assertPublicDownloads?.([...named.map(p=>publicUrl(p.name)),checksumsUrl,reportUrl])
    for(const {receipt:r,name} of named){const verification={...r.verification};delete verification.workDir
      publications.push({buildKey:r.buildKey,recipeId:r.recipeId,version:r.source.version,source:r.source,host:r.host,target:r.target,status:'published',sha256:r.artifacts.sha256,compressedBytes:r.artifacts.compressedBytes,unpackedBytes:r.artifacts.unpackedBytes,packageUrl:publicUrl(name),reportUrl,assets:{package:publicUrl(name),checksums:checksumsUrl,reports:reportUrl},verification,fileName:name,presentationVersion:2,releaseTag:tag,plannedAt:r.plannedAt,publishedAt:state.published[r.buildKey]?.publishedAt??new Date().toISOString()})
    }
  }
  const next = mergeState(state,{receipts,publications})
  return {schemaVersion:1,dryRun,batchId,actions,publications,state:next,catalog:catalogOf(next,recipes)}
}
export function packageFileName(receipt){
 const {recipeId,source,target}=receipt
 if(!/^[a-z0-9][a-z0-9-]*$/.test(recipeId??'')||!/^[0-9A-Za-z.+-]+$/.test(source?.version??'')||!['darwin-arm64','linux-x64','win32-x64'].includes(target))throw Error('Invalid public package identity')
 return `${recipeId}-${source.version}-${target}.tgz`
}
export function githubReleaseRemote({ repository, github }) {
  const base=`/repos/${repository}`
  async function checked(asset){let sha256=asset.digest?.replace(/^sha256:/,'');if(!sha256){const r=await fetch(github.baseUrl+base+`/releases/assets/${asset.id}`,{headers:{accept:'application/octet-stream',...(github.token?{authorization:`Bearer ${github.token}`}:{})},signal:AbortSignal.timeout(120000)});if(!r.ok)throw Error('Cannot verify remote asset');sha256=digest(Buffer.from(await r.arrayBuffer()))}return{sha256,url:asset.browser_download_url}}
  return {
    async ensureDraft(tag){try{return(await github.request(base+`/releases/tags/${tag}`)).data}catch(e){if(e.status!==404)throw e;return(await github.request(base+'/releases',{method:'POST',body:{tag_name:tag,name:`DSH 插件离线包 · ${new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())}`,body:'安装包命名：插件-版本-平台.tgz。SHA256SUMS 为校验清单，reports.json 包含源码、依赖和验证记录。\n\n安装与版本说明：https://fatevase.github.io/dsh_depot/',draft:true,prerelease:false}})).data}},
    async asset(release,name){const assets=await github.list(base+`/releases/${release.id}/assets`);const a=assets.find(a=>a.name===name);return a?checked(a):null},
    async upload(release,name,file,sha){const bytes=Buffer.isBuffer(file)?file:await readFile(file),url=new URL(release.upload_url.split('{')[0]);if(url.hostname!=='uploads.github.com')throw Error('Unexpected upload origin');url.searchParams.set('name',name);const r=await fetch(url,{method:'POST',headers:{authorization:`Bearer ${github.token}`,'content-type':'application/octet-stream'},body:bytes,signal:AbortSignal.timeout(120000)});if(!r.ok)throw Error(`Asset upload HTTP ${r.status}`);return checked(await r.json())},
    async assertPublicDownloads(urls){for(const url of urls){const response=await fetch(url,{method:'HEAD',redirect:'follow',signal:AbortSignal.timeout(30000)});if(!response.ok)throw Error(`Published download returned HTTP ${response.status}: ${new URL(url).pathname}`)}},
    async publish(release){if(release.draft)await github.request(base+`/releases/${release.id}`,{method:'PATCH',body:{draft:false}})}
  }
}
