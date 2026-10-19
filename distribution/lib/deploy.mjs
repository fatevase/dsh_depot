import { generateSite } from './site.mjs'
export async function refreshDeployment({store,recipes,outDir,managerCatalog}){
 const current=await store.read()
 const result=await generateSite({state:current.state,recipes,outDir,managerCatalog})
 return {...result,stateCommit:current.commit}
}
