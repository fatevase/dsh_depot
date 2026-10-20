import path from 'node:path'
import {atomicJson,digest} from '@dsh-depot/offline-format/files'
import {applyCategories} from './categories.mjs'

// The directory carries summaries. Receipts are independent JSON files.
export async function writeBuildData(input,outDir){
 const catalog=structuredClone(applyCategories(input)),records=[]
 async function write(url,value){
  await atomicJson(path.join(outDir,url),value)
  return {recordUrl:url}
 }
 for(const plugin of catalog.plugins){
  const trial=plugin.trial
  if(!trial)continue
  if(!Number.isSafeInteger(catalog.candidateBuild?.runId)||!Number.isSafeInteger(trial.repositoryId))throw Error('Invalid build record identity')
  const runId=catalog.candidateBuild.runId,attempt=catalog.candidateBuild.runAttempt??1
  if(runId<1||trial.repositoryId<1||!Number.isSafeInteger(attempt)||attempt<1)throw Error('Invalid build record run')
  for(const [target,result]of Object.entries(trial.results)){
   if(!['macos-arm64','linux-x64','win32-x64'].includes(target))throw Error('Invalid build record target')
   const url=`builds/${runId}-${attempt}/${trial.repositoryId}/${target}.json`
   const record={schemaVersion:1,kind:'candidate',pluginId:plugin.id,repository:trial.repository,repositoryId:trial.repositoryId,runId,runAttempt:attempt,completedAt:catalog.candidateBuild.completedAt,sourceCommit:trial.commit,runUrl:trial.runUrl,target,result}
   const ref=await write(url,record)
   records.push({pluginId:plugin.id,name:plugin.name,repository:plugin.repository,category:plugin.category,target,status:result.status,version:result.version,runId,runAttempt:attempt,completedAt:record.completedAt,errorCategory:result.errorCategory,warnings:result.warnings?.length??0,...ref})
   trial.results[target]={status:result.status,version:result.version,errorCategory:result.errorCategory,files:(result.files??[]).map(({name,version,filename,bytes,sha256,url,downloadFilename})=>({name,version,filename,bytes,sha256,url,downloadFilename})),...ref}
  }
 }
 for(const pkg of catalog.packages){
  if(!pkg.buildKey)continue
  const record={schemaVersion:1,kind:'package',buildKey:pkg.buildKey,target:pkg.target,package:structuredClone(pkg)}
  const ref=await write(`builds/packages/${digest(pkg.buildKey)}.json`,record)
  // Public browsing needs status and downloads, not every verification payload.
  pkg.verification={status:pkg.verification?.status,...(pkg.verification?.error?.message?{error:{message:pkg.verification.error.message}}:{})}
  for(const key of ['dependencies','toolchain','timings','sourceArchiveSha256'])delete pkg[key]
  if(pkg.assets)pkg.assets={checksums:pkg.assets.checksums}
  Object.assign(pkg,ref)
 }
 const index={schemaVersion:1,campaign:catalog.candidateBuild??null,records}
 await write('builds/index.json',index)
 if(catalog.candidateBuild)catalog.candidateBuild.recordUrl='builds/index.json'
 return catalog
}
