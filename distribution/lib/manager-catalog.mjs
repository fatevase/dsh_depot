import {qualifyManagerReport} from '@dsh-depot/offline-format/manager-qualification'
const repository='fatevase/dsh_depot'
export async function latestManagerCatalog({github,fetchImpl=fetch}){
 const releases=await github.list(`/repos/${repository}/releases`)
 const latest=releases.find(r=>!r.draft&&!r.prerelease&&/^manager-\d+$/.test(r.tag_name??'')&&r.assets?.some(a=>a.name==='manager-catalog.json'))
 if(!latest)return{schemaVersion:1,packages:[]}
 const asset=latest.assets.find(a=>a.name==='manager-catalog.json'),url=asset.browser_download_url
 if(!url?.startsWith(`https://github.com/${repository}/releases/download/${latest.tag_name}/`))throw Error('Unexpected manager catalog source')
 const response=await fetchImpl(url,{signal:AbortSignal.timeout(30000)});if(!response.ok)throw Error('Published manager catalog unavailable')
 const chunks=[];let bytes=0;for await(const chunk of response.body){bytes+=chunk.length;if(bytes>2*1024*1024)throw Error('Manager catalog too large');chunks.push(Buffer.from(chunk))}
 const catalog=JSON.parse(Buffer.concat(chunks).toString('utf8'))
 if(catalog.schemaVersion!==1||!Array.isArray(catalog.packages))throw Error('Invalid manager catalog')
 for(const p of catalog.packages)if(!p.packageUrl?.startsWith(`https://github.com/${repository}/releases/download/`)||qualifyManagerReport(p.verification??{}).status!=='passed'||p.verification.bundleSha256!==p.sha256)throw Error('Unqualified manager catalog entry')
 return catalog
}
