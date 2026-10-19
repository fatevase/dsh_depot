import {appendFile} from 'node:fs/promises'
import {Github} from './lib/github.mjs'
import {deployPages} from './lib/pages-deployment.mjs'

const env=process.env
try {
 if(!env.GITHUB_TOKEN||!env.ACTIONS_ID_TOKEN_REQUEST_TOKEN||!env.ACTIONS_ID_TOKEN_REQUEST_URL||!env.GITHUB_OUTPUT)throw Error('Pages deployment requires the trusted Actions environment')
 const response=await fetch(env.ACTIONS_ID_TOKEN_REQUEST_URL,{headers:{authorization:`Bearer ${env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}`},signal:AbortSignal.timeout(30000)})
 if(!response.ok)throw Error(`Pages OIDC request returned ${response.status}`)
 const {value:oidcToken}=await response.json()
 // A create request must not be retried after an ambiguous network failure.
 const github=new Github({token:env.GITHUB_TOKEN,retries:0})
 const result=await deployPages({github,repository:env.GITHUB_REPOSITORY,sourceSha:env.GITHUB_SHA,runId:env.GITHUB_RUN_ID,runAttempt:env.GITHUB_RUN_ATTEMPT,artifactId:Number(env.PAGES_ARTIFACT_ID),oidcToken})
 await appendFile(env.GITHUB_OUTPUT,`page_url=${result.pageUrl}\n`)
 console.log(`Pages deployed: ${result.version} ${result.pageUrl}`)
}catch(error){console.error(error.message);process.exitCode=1}
