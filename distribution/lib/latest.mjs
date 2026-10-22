import semver from 'semver'

export async function latestHostVersion(load=async()=>{
 const response=await fetch('https://registry.npmjs.org/@deepseek-ai%2fdsh',{signal:AbortSignal.timeout(30000)})
 if(!response.ok)throw Error(`DSH registry HTTP ${response.status}`)
 return response.json()
}){
 const version=(await load())['dist-tags']?.latest
 if(!semver.valid(version))throw Error('Official DSH latest tag is invalid')
 return version
}
export async function latestSource(recipe,github){
 const base=`/repos/${recipe.repository}`
 const eligible=tag=>semver.valid(tag)&&(!semver.prerelease(tag)||recipe.channel?.allowPrerelease)
 const releases=(await github.list(base+'/releases')).filter(r=>!r.draft&&(!r.prerelease||recipe.channel?.allowPrerelease)&&eligible(r.tag_name)).sort((a,b)=>semver.rcompare(a.tag_name,b.tag_name))
 async function resolve(ref,channel){
  if(typeof ref!=='string'||!ref||/[\r\n\0]/.test(ref))throw Error('Invalid latest source ref')
  const commit=(await github.request(base+'/commits/'+encodeURIComponent(ref))).data.sha
  if(!/^[a-f0-9]{40}$/.test(commit??''))throw Error('Latest source did not resolve to a commit')
  return{ref,commit,channel}
 }
 async function matchesProduct(selected){
  if(!recipe.npmName||!github.text)return true
  const prefix=recipe.packagePath&&recipe.packagePath!=='.'?recipe.packagePath+'/':''
  let manifest
  try{manifest=JSON.parse(await github.text(recipe.repository,prefix+'package.json',selected.commit))}catch(error){if(error.status===404)return false;throw error}
  return manifest.name===recipe.npmName&&!!semver.valid(manifest.version)
 }
 for(const r of releases){const selected=await resolve(r.tag_name,'release');if(await matchesProduct(selected))return selected}
 const tags=(await github.list(base+'/tags')).filter(t=>eligible(t.name)&&!releases.some(r=>r.tag_name===t.name)).sort((a,b)=>semver.rcompare(a.name,b.name))
 for(const tag of tags){const selected=await resolve(tag.name,'tag');if(await matchesProduct(selected))return selected}
 const ref=(await github.request(base)).data.default_branch
 return resolve(ref,'branch')
}

export function runtimeManifest(manifest,recipe){
 const local=new Set((recipe.packageRules?.localPackages??[]).map(p=>p.name)),result={name:manifest.name,version:manifest.version,private:true}
 for(const kind of ['dependencies','optionalDependencies']){
  const entries=Object.entries(manifest[kind]??{}).filter(([name])=>!local.has(name))
  for(const [name,range]of entries)if(!/^(@[\w.-]+\/)?[\w.-]+$/.test(name)||!semver.validRange(range))throw Error(`Runtime adapter needs a registry dependency: ${name}`)
  if(entries.length)result[kind]=Object.fromEntries(entries)
 }
 return result
}
export function freezeRuntimeVersions(manifest,lock){
 for(const kind of ['dependencies','optionalDependencies'])for(const name of Object.keys(manifest[kind]??{})){
  const version=lock.packages?.[`node_modules/${name}`]?.version
  if(!semver.valid(version))throw Error(`Cannot freeze direct runtime dependency: ${name}`)
  manifest[kind][name]=version
 }
 Object.assign(lock.packages[''],manifest)
 return lock
}
export function assertLatestRef(recipe,selected){
 if(selected.channel==='branch')return
 const old=recipe.releasePins?.[selected.ref]??(recipe.seed?.ref===selected.ref?recipe.seed.commit:undefined)
 if(old&&old!==selected.commit)throw Error('source_conflict: previously observed release/tag moved')
}
