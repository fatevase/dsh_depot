import {createHash} from 'node:crypto'
import {setTimeout as delay} from 'node:timers/promises'

// Catalogs can change without a source commit. GitHub requires a unique build
// version, so the artifact and run identity must also participate in that version.
export async function deployPages({github,repository,sourceSha,runId,runAttempt,artifactId,oidcToken,maxPolls=48,wait=()=>delay(5000)}) {
 if(!/^[\w.-]+\/[\w.-]+$/.test(repository??'')||!/^[a-f0-9]{40}$/.test(sourceSha??'')||!/^\d+$/.test(String(runId))||!/^\d+$/.test(String(runAttempt))||!Number.isSafeInteger(artifactId)||artifactId<=0||!oidcToken)throw Error('Invalid Pages deployment identity')
 const version=createHash('sha256').update([sourceSha,runId,runAttempt,artifactId].join(':')).digest('hex').slice(0,40)
 const endpoint=`/repos/${repository}/pages/deployments`
 const {data}=await github.request(endpoint,{method:'POST',body:{artifact_id:artifactId,pages_build_version:version,oidc_token:oidcToken}})
 if(!data?.id||typeof data.page_url!=='string')throw Error('Pages deployment returned no identity or URL')
 const deployment=`${endpoint}/${encodeURIComponent(data.id)}`
 let succeeded=false
 try {
  for(let poll=0;poll<maxPolls;poll++){
   const {data:status}=await github.request(deployment)
   if(status?.status==='succeed'){succeeded=true;return {pageUrl:data.page_url,version,deploymentId:data.id}}
   if(!status?.status||['deployment_failed','deployment_content_failed','deployment_cancelled','deployment_lost'].includes(status.status))throw Error(`Pages deployment failed: ${status?.status??'missing status'}`)
   await wait()
  }
  throw Error('Pages deployment timed out')
 }finally{if(!succeeded)await github.request(deployment+'/cancel',{method:'POST'}).catch(()=>{})}
}
