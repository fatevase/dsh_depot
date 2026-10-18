import path from 'node:path'
import { mkdir } from 'node:fs/promises'
import { fileDigest } from './model.mjs'
import { downloadArchive } from './build.mjs'
import { packageFileName } from './publish.mjs'
import { supportedTarget } from './platform.mjs'

// Reuse only current verified bytes. The normal publisher rechecks their plan and proof.
export async function recoverPublishedReceipts({state,repository,github,workDir,recipeIds,excludeKeys=new Set(),download=downloadArchive}){
 const pending=[...new Set(Object.values(state.latest))].map(key=>state.published[key]).filter(p=>p?.status==='published'&&supportedTarget(p.target)&&p.presentationVersion!==2&&!state.withdrawn[p.buildKey]&&recipeIds.has(p.recipeId)&&!excludeKeys.has(p.buildKey))
 if(!pending.length)return {receipts:[],tasks:[]}
 const releases=(await github.list(`/repos/${repository}/releases`)).filter(r=>!r.draft),receipts=[],tasks=[]
 for(const p of pending){
  const original=state.receipts[p.buildKey]
  if(original?.status!=='verified'||p.verification?.status!=='passed'||original.artifacts?.sha256!==p.sha256)throw Error('Previously published package has no matching verified receipt')
  const asset=releases.flatMap(r=>r.assets??[]).find(a=>a.name===p.fileName&&a.digest===`sha256:${p.sha256}`)
  if(!asset)throw Error(`Cannot locate verified published asset: ${p.fileName}`)
  const url=new URL(asset.browser_download_url)
  if(url.origin!=='https://github.com'||!url.pathname.startsWith(`/${repository}/releases/download/`)||url.pathname.includes('/untagged-'))throw Error('Expected a final public release URL')
  const dir=path.join(workDir,p.buildKey);await mkdir(dir,{recursive:true})
  const file=path.join(dir,packageFileName(original));await download(url.href,file)
  if(await fileDigest(file)!==p.sha256)throw Error('Recovered package checksum mismatch')
  const receipt=structuredClone(original);receipt.artifacts={package:file,sha256:p.sha256,compressedBytes:p.compressedBytes,unpackedBytes:p.unpackedBytes,manifest:original.artifacts.manifest}
  receipts.push(receipt);tasks.push(Object.fromEntries(['buildKey','recipeId','recipeDigest','source','host','target','plannedAt'].map(k=>[k,original[k]])))
 }
 return {receipts,tasks}
}
