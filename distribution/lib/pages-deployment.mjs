import {setTimeout as delay} from 'node:timers/promises'

// A real commit on pages-builds gives each artifact its own deployment identity.
export async function deployPages({github,repository,buildVersion:version,artifactId,oidcToken,maxPolls=48,wait=()=>delay(5000)}) {
 if(!/^[\w.-]+\/[\w.-]+$/.test(repository??'')||!/^[a-f0-9]{40}$/.test(version??'')||!Number.isSafeInteger(artifactId)||artifactId<=0||!oidcToken)throw Error('Invalid Pages deployment identity')
 const endpoint=`/repos/${repository}/pages/deployments`
 const {data}=await github.request(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:{artifact_id:artifactId,pages_build_version:version,oidc_token:oidcToken}})
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
