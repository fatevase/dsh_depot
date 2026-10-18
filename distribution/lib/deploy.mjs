import { generateSite } from './site.mjs'
export async function refreshDeployment({store,recipes,outDir}){
 const current=await store.read()
 const result=await generateSite({state:current.state,recipes,outDir})
 return {...result,stateCommit:current.commit}
}
