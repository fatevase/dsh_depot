import {campaignMatrix} from './candidate-build.mjs'
import {jsonDigest} from './model.mjs'
// Bump when the candidate compiler/packer contract changes.
export const candidateInputKey=(entry,target)=>jsonDigest({version:2,entry,target,node:'26.9.0'})
export function selectCandidateUpdates(config,{scheduled=false,previous={},maxPlugins=5,batch,target}={}){
 const full=campaignMatrix(config,{batch,target}),eligible=new Set(full.include.flatMap(j=>j.entries.map(e=>e.repositoryId)))
 const targets=[...new Set(full.include.map(j=>j.target))]
 const entries=config.entries.filter(e=>eligible.has(e.repositoryId)&&(!scheduled||targets.some(t=>previous[`${e.repositoryId}:${t}`]!==candidateInputKey(e,t)))).slice(0,scheduled?maxPlugins:Infinity)
 const selected=new Set(entries.map(e=>e.repositoryId))
 const matrix={include:full.include.map(j=>({...j,entries:j.entries.filter(e=>selected.has(e.repositoryId))})).filter(j=>j.entries.length)}
 return{entries,targets,matrix}
}
