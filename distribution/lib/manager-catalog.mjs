import {isManagerDownload} from '@dsh-depot/offline-format/manager-qualification'
const repository='fatevase/dsh_depot'
export async function latestManagerCatalog({github,fetchImpl=fetch}){
 const releases=await github.list(`/repos/${repository}/releases`)
 const eligible=releases.filter(r=>!r.draft&&/^manager-(?:preview-)?\d+$/.test(r.tag_name??'')&&r.assets?.some(a=>a.name==='manager-catalog.json'))
 const selected=[eligible.find(r=>!r.prerelease&&/^manager-\d+$/.test(r.tag_name)),eligible.find(r=>r.prerelease&&/^manager-preview-\d+$/.test(r.tag_name))].filter(Boolean)
 if(!selected.length)return{schemaVersion:1,packages:[]}
 const catalogs=[]
 for(const release of selected){
  const url=release.assets.find(a=>a.name==='manager-catalog.json').browser_download_url
  if(!url?.startsWith(`https://github.com/${repository}/releases/download/${release.tag_name}/`))throw Error('Unexpected manager catalog source')
  const response=await fetchImpl(url,{signal:AbortSignal.timeout(30000)});if(!response.ok)throw Error('Published manager catalog unavailable')
  const chunks=[];let bytes=0;for await(const chunk of response.body){bytes+=chunk.length;if(bytes>2*1024*1024)throw Error('Manager catalog too large');chunks.push(Buffer.from(chunk))}
  const catalog=JSON.parse(Buffer.concat(chunks).toString('utf8'))
  if(catalog.schemaVersion!==1||!Array.isArray(catalog.packages))throw Error('Invalid manager catalog')
  for(const p of catalog.packages)if(!isManagerDownload(p))throw Error('Unqualified manager catalog entry')
  catalogs.push(catalog)
 }
 if(catalogs.length===1)return catalogs[0]
 const merged=new Map();for(const catalog of catalogs)for(const p of catalog.packages){const key=p.target+':'+p.flavor;if(!merged.has(key))merged.set(key,p)}
 return{...catalogs[0],packages:[...merged.values()]}
}
