import {readJson,within} from './model.mjs'
const repository = value => typeof value==='string' && /^[\w.-]+\/[\w.-]+$/.test(value)
export async function readPluginList(config,root){
 if(!config.pluginList)return{active:config.cohort?.plugins,candidates:[]}
 const list=await readJson(within(root,config.pluginList))
 if(list.schemaVersion!==1 || !Array.isArray(list.active) || !list.active.length || !Array.isArray(list.candidates))throw Error('Invalid plugin list schema')
 const cutoff=Date.parse(list.selection?.cutoffInclusive),minimum=list.selection?.minStars
 if(!Number.isFinite(cutoff)||!Number.isSafeInteger(minimum)||minimum<50)throw Error('Invalid candidate selection rules')
 const activeIds=new Set(),activeRepositories=new Set(),ids=new Set(),repositories=new Set()
 for(const entry of list.active){
  if(!/^[a-z0-9][a-z0-9-]*$/.test(entry.recipeId??'')||!repository(entry.repository))throw Error('Invalid active plugin')
  const key=entry.repository.toLowerCase()
  if(activeIds.has(entry.recipeId)||activeRepositories.has(key))throw Error('Duplicate active plugin')
  activeIds.add(entry.recipeId);activeRepositories.add(key)
 }
 for(const entry of list.candidates){
  if(!repository(entry.repository)||!Number.isSafeInteger(entry.repositoryId)||entry.repositoryId<1)throw Error('Invalid candidate identity')
  const key=entry.repository.toLowerCase()
  if(ids.has(entry.repositoryId)||repositories.has(key))throw Error('Duplicate candidate identity')
  ids.add(entry.repositoryId);repositories.add(key)
  if(!Number.isSafeInteger(entry.stars)||entry.stars<minimum||!Number.isFinite(Date.parse(entry.pushedAt))||Date.parse(entry.pushedAt)<cutoff)throw Error('Candidate violates snapshot selection rules')
 }
 return list
}
