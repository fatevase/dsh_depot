import path from 'node:path'
import {verifyArtifact} from '../lib/verify.mjs'
import {hostEnvironmentDigest} from '../lib/host-environment.mjs'
import {fileHash,atomicJson} from '@dsh-depot/offline-format/files'
import {qualifyManagerReport} from '@dsh-depot/offline-format/manager-qualification'
export {qualifyManagerReport}
export async function verifyManager({bundle,host,isolation,workDir}) {
 const recipe={id:'dsh-depot-manager',npmName:'dsh-depot-manager',installTimeoutMs:180000,probes:{clientModule:'dsh-depot-manager/client',registrations:[{name:'dsh-depot-manager'}],native:[]}}
 // Existing OS-isolated verifier proves cold installation/composition/startup only.
 const base=await verifyArtifact({task:{buildKey:bundle.sourceDigest,target:bundle.target,host:{node:process.versions.node,version:host.version,environmentDigest:hostEnvironmentDigest()}},recipe:{...recipe,probes:{clientModule:'dsh-depot-manager/client',native:[]}},artifact:{package:bundle.path,sha256:bundle.sha256},host,isolation,workDir})
 const evidence={};for(const [scope,key] of [['cold-install','install'],['config-compose','compose'],['host-page-smoke','host']])evidence[scope]={status:base.checks[key]?'passed':'failed',log:base.workDir}
 evidence['network-isolation']={status:base.isolationControls?.status??'unverified',controls:base.isolationControls}
 const report=qualifyManagerReport({schemaVersion:1,target:bundle.target,host:{version:host.version,node:process.versions.node},packageSha256:await fileHash(bundle.path),bundleSha256:null,status:base.status,scope:[...base.scope,'network-isolation'],checks:{...base.checks,native:null},evidence,verification:base})
 await atomicJson(path.join(workDir,'manager-verification.json'),report);return report
}
