// Public download metadata is separate from trial status and offline validation.
const repository='fatevase/dsh_depot'
async function singleRunDownloads({github,snapshot,fetchImpl=fetch}){
 if(!snapshot)return snapshot
 const tag=`candidate-${snapshot.runId}-${snapshot.runAttempt??1}`
 let release
 try{release=(await github.request(`/repos/${repository}/releases/tags/${tag}`)).data}catch(e){if(e.status===404)return snapshot;throw e}
 if(release.draft||!release.prerelease||release.tag_name!==tag)return snapshot
 const asset=release.assets?.find(a=>a.name==='candidate-downloads.json'),prefix=`https://github.com/${repository}/releases/download/${tag}/`
 if(!asset||asset.size>4*1024*1024||asset.browser_download_url!==prefix+'candidate-downloads.json')throw Error('Invalid candidate download catalog asset')
 const response=await fetchImpl(asset.browser_download_url,{signal:AbortSignal.timeout(30000)})
 if(!response.ok)throw Error('Candidate download catalog is unavailable')
 const chunks=[];let bytes=0
 for await(const chunk of response.body){bytes+=chunk.length;if(bytes>4*1024*1024)throw Error('Candidate download catalog too large');chunks.push(Buffer.from(chunk))}
 const data=JSON.parse(Buffer.concat(chunks).toString('utf8'))
 const ids=new Set(snapshot.plugins.flatMap(p=>Object.keys(p.results).map(t=>`${p.repositoryId}:${t}`)))
 return applyCandidateDownloads(snapshot,{...data,packages:Array.isArray(data.packages)?data.packages.filter(p=>ids.has(`${p.repositoryId}:${p.target}`)):data.packages},prefix)
}
export function applyCandidateDownloads(snapshot,data,prefix){
 if(data.schemaVersion!==1||data.verification!=='not-run'||data.runId!==snapshot.runId||data.runAttempt!==(snapshot.runAttempt??1)||!Array.isArray(data.packages))throw Error('Candidate download catalog identity mismatch')
 const entries=new Map()
 for(const p of data.packages){
  const trial=snapshot.plugins.find(t=>t.repositoryId===p.repositoryId),result=trial?.results[p.target],file=result?.files.find(f=>f.filename===p.filename)
  if(result?.status!=='compiled'||!file||trial.commit!==p.sourceCommit||p.repository!==trial.repository||p.sha256!==file.sha256||p.bytes!==file.bytes||p.version!==file.version||!/^\d+-[A-Za-z0-9._+-]+-(macos-arm64|linux-x64|win32-x64)\.tgz$/.test(p.assetName??'')||p.url!==prefix+encodeURIComponent(p.assetName))throw Error('Candidate download differs from checked build receipt')
  const key=`${p.repositoryId}:${p.target}:${p.filename}`
  if(entries.has(key))throw Error('Duplicate candidate download')
  entries.set(key,p)
 }
 return {...snapshot,downloadsUrl:prefix+'candidate-downloads.json',plugins:snapshot.plugins.map(p=>({...p,results:Object.fromEntries(Object.entries(p.results).map(([target,r])=>[target,{...r,files:r.files.map(f=>{
  const item=entries.get(`${p.repositoryId}:${target}:${f.filename}`)
  return {...f,...(item?{url:item.url,downloadFilename:item.assetName}:{})}
 })}]))}))}
}

export async function candidatePublicDownloads({snapshot,...options}){
 if(!snapshot)return snapshot
 const groups=new Map()
 for(const p of snapshot.plugins)for(const [target,result]of Object.entries(p.results)){
  const runId=result.runId??p.runId??snapshot.runId,runAttempt=result.runAttempt??p.runAttempt??snapshot.runAttempt??1
  if(!runId)continue
  const key=`${runId}:${runAttempt}`
  if(!groups.has(key))groups.set(key,{...snapshot,runId,runAttempt,plugins:[]})
  const group=groups.get(key);let plugin=group.plugins.find(item=>item.repositoryId===p.repositoryId)
  if(!plugin){plugin={...p,results:{}};group.plugins.push(plugin)}
  plugin.results[target]=result
 }
 const found=new Map()
 for(const group of groups.values()){
  const result=await singleRunDownloads({...options,snapshot:group})
  for(const p of result.plugins){const old=found.get(p.repositoryId);found.set(p.repositoryId,{...p,results:{...old?.results,...p.results}})}
 }
 return {...snapshot,plugins:snapshot.plugins.map(p=>({...p,results:{...p.results,...found.get(p.repositoryId)?.results}}))}
}
