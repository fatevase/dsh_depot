import path from 'node:path'
import {verifyArtifact} from '../lib/verify.mjs'
import {hostEnvironmentDigest} from '../lib/host-environment.mjs'
import {fileHash,atomicJson} from './core/files.mjs'
const REQUIRED=['network-isolation','cold-install','config-compose','host-page-smoke','authenticated-manager-page','script-install','replace','uninstall','recovery','native-load']
export function qualifyManagerReport(report) {
 const missing=REQUIRED.filter(check=>!report.scope?.includes(check)||report.evidence?.[check]?.status!=='passed')
 return {...report,status:report.status==='failed'?'failed':missing.length?'unverified':'passed',missing}
}
export async function verifyManager({bundle,host,isolation,workDir}) {
 const recipe={id:'dsh-depot-manager',npmName:'dsh-depot-manager',installTimeoutMs:180000,probes:{clientModule:'离线插件',registrations:[{name:'dsh-depot-manager'}],native:[]}}
 // Existing OS-isolated verifier proves cold installation/composition/startup only.
 const base=await verifyArtifact({task:{buildKey:bundle.sourceDigest,target:bundle.target,host:{node:process.versions.node,version:host.version,environmentDigest:hostEnvironmentDigest()}},recipe:{...recipe,probes:{clientModule:'离线插件',native:[]}},artifact:{package:bundle.path,sha256:bundle.sha256},host,isolation,workDir})
 const evidence={};for(const [scope,key] of [['cold-install','install'],['config-compose','compose'],['host-page-smoke','host']])evidence[scope]={status:base.checks[key]?'passed':'failed',log:base.workDir}
 evidence['network-isolation']={status:base.isolationControls?.status??'unverified',controls:base.isolationControls}
 const report=qualifyManagerReport({schemaVersion:1,target:bundle.target,host:{version:host.version,node:process.versions.node},packageSha256:await fileHash(bundle.path),bundleSha256:null,status:base.status,scope:[...base.scope,'network-isolation'],checks:{...base.checks,native:null},evidence,verification:base})
 await atomicJson(path.join(workDir,'manager-verification.json'),report);return report
}
