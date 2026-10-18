import path from 'node:path'
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
      if (old) { if (old.sha256 !== r.artifacts.sha256) throw new Error('Immutable key checksum conflict'); actions.push({buildKey:r.buildKey,action:'skip',reason:'Already published'});continue }
      accepted.push(r);actions.push({buildKey:r.buildKey,action:dryRun?'would_publish':'publish'})
    } catch(error) { actions.push({buildKey:r.buildKey,action:'rejected',reason:error.message}) }
  }
  let publications = []
  if (!dryRun && accepted.length) {
    remote ??= githubReleaseRemote({ repository, github })
    const release = await remote.ensureDraft(`depot-${batchId}`)
    // Never add assets to a public release: a rerun may only validate existing bytes.
    for (const receipt of accepted) {
      const assets = { package: receipt.artifacts.package, ...Object.fromEntries(['provenance','dependencies','checksums'].filter(k=>receipt.artifacts[k]).map(k=>[k,receipt.artifacts[k]])) }
      const urls = {}
      for (const [kind, file] of Object.entries(assets)) {
        const name = kind === 'package' ? path.basename(file) : `${receipt.buildKey}-${kind}${path.extname(file)}`, sha = await fileDigest(file)
        let asset = await remote.asset(release, name)
        if (asset) { if (asset.sha256 !== sha) throw new Error(`Immutable asset checksum conflict: ${name}`) }
        else { if (!release.draft) throw new Error('Public release missing an asset; use a new batch ID'); asset = await remote.upload(release,name,file,sha); if(asset.sha256!==sha)throw new Error('Uploaded asset checksum mismatch') }
        urls[kind] = asset.url
      }
      // Report is uploaded as bytes from the verified receipt, with no local path.
      const report = { ...receipt.verification }; delete report.workDir
      const name = `${receipt.buildKey}-verification.json`, bytes = Buffer.from(JSON.stringify(report,null,2)+'\n'), sha = digest(bytes)
      let asset = await remote.asset(release,name)
      if(asset && asset.sha256!==sha)throw new Error('Immutable verification checksum conflict')
      if(!asset){if(!release.draft)throw new Error('Public release missing verification');asset=await remote.upload(release,name,bytes,sha)}
      if(asset.sha256!==sha)throw new Error('Verification upload checksum mismatch')
      publications.push({buildKey:receipt.buildKey,recipeId:receipt.recipeId,version:receipt.source.version,source:receipt.source,host:receipt.host,target:receipt.target,status:'published',sha256:receipt.artifacts.sha256,compressedBytes:receipt.artifacts.compressedBytes,unpackedBytes:receipt.artifacts.unpackedBytes,packageUrl:urls.package,reportUrl:asset.url,assets:urls,verification:report,fileName:path.basename(receipt.artifacts.package),plannedAt:receipt.plannedAt,publishedAt:new Date().toISOString()})
    }
    await remote.publish(release)
  }
  const next = mergeState(state,{receipts,publications})
  return {schemaVersion:1,dryRun,batchId,actions,publications,state:next,catalog:catalogOf(next,recipes)}
}
export function githubReleaseRemote({ repository, github }) {
  const base=`/repos/${repository}`
  async function checked(asset){let sha256=asset.digest?.replace(/^sha256:/,'');if(!sha256){const r=await fetch(github.baseUrl+base+`/releases/assets/${asset.id}`,{headers:{accept:'application/octet-stream',...(github.token?{authorization:`Bearer ${github.token}`}:{})},signal:AbortSignal.timeout(120000)});if(!r.ok)throw Error('Cannot verify remote asset');sha256=digest(Buffer.from(await r.arrayBuffer()))}return{sha256,url:asset.browser_download_url}}
  return {
    async ensureDraft(tag){try{return(await github.request(base+`/releases/tags/${tag}`)).data}catch(e){if(e.status!==404)throw e;return(await github.request(base+'/releases',{method:'POST',body:{tag_name:tag,name:`DSH offline packages · ${tag}`,draft:true,prerelease:false}})).data}},
    async asset(release,name){const assets=await github.list(base+`/releases/${release.id}/assets`);const a=assets.find(a=>a.name===name);return a?checked(a):null},
    async upload(release,name,file,sha){const bytes=Buffer.isBuffer(file)?file:await readFile(file),url=new URL(release.upload_url.split('{')[0]);if(url.hostname!=='uploads.github.com')throw Error('Unexpected upload origin');url.searchParams.set('name',name);const r=await fetch(url,{method:'POST',headers:{authorization:`Bearer ${github.token}`,'content-type':'application/octet-stream'},body:bytes,signal:AbortSignal.timeout(120000)});if(!r.ok)throw Error(`Asset upload HTTP ${r.status}`);return checked(await r.json())},
    async publish(release){if(release.draft)await github.request(base+`/releases/${release.id}`,{method:'PATCH',body:{draft:false}})}
  }
}
