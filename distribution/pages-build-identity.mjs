// Pages currently resolves pages_build_version as a Git commit even though its
// REST documentation calls it a unique string. Keep those records off main.
export async function createPagesBuildIdentity({github,repository,sourceSha,runId,runAttempt,artifactId}) {
 if(!/^[\w.-]+\/[\w.-]+$/.test(repository??'')||!/^[a-f0-9]{40}$/.test(sourceSha??'')||!/^\d+$/.test(String(runId))||!/^\d+$/.test(String(runAttempt))||!Number.isSafeInteger(artifactId)||artifactId<=0)throw Error('Invalid Pages build identity')
 const root=`/repos/${repository}/git`,branch='pages-builds'
 let previous
 try{previous=(await github.request(`${root}/ref/heads/${branch}`)).data.object.sha}catch(error){if(error.status!==404)throw error}
 const record={schemaVersion:1,sourceSha,runId,runAttempt,artifactId}
 const write=(endpoint,body,method='POST')=>github.request(endpoint,{method,headers:{'content-type':'application/json'},body})
 const {data:tree}=await write(`${root}/trees`,{tree:[{path:'.pages-build.json',mode:'100644',type:'blob',content:JSON.stringify(record,null,2)+'\n'}]})
 const {data:commit}=await write(`${root}/commits`,{message:`Pages artifact ${artifactId} (run ${runId}/${runAttempt})`,tree:tree.sha,parents:previous?[previous]:[]})
 if(!/^[a-f0-9]{40}$/.test(commit?.sha??''))throw Error('Pages build commit missing')
 if(previous)await write(`${root}/refs/heads/${branch}`,{sha:commit.sha,force:false},'PATCH')
 else await write(`${root}/refs`,{ref:`refs/heads/${branch}`,sha:commit.sha})
 return commit.sha
}
