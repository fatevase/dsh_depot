import test from 'node:test'
import assert from 'node:assert/strict'
import { assertVerification } from '../lib/verify.mjs'
const task={buildKey:'a'.repeat(64),target:'darwin-arm64',host:{version:'0.2.0-rc.2',node:'26.9.0'}}
const proof=()=>({schemaVersion:1,...task,sha256:'b'.repeat(64),status:'passed',isolationControls:{beforeReachable:true,beforeReachableIPv6:true,offline:{externalBlocked:true,externalBlockedIPv6:true,childBlockedIPv6:true,otherProgramBlocked:true,loopbackBlocked:true,childBlocked:true},loopback:{externalBlocked:true,externalBlockedIPv6:true,childBlockedIPv6:true,otherProgramBlocked:true,loopbackAllowed:true,childBlocked:true}},checks:{install:true,compose:true,host:true,clientModule:true,native:true},scope:['cold-install','host-smoke']})
test('publishing needs the same artifact, target, host and actual isolation controls',()=>{
 assert.equal(assertVerification(proof(),task,'b'.repeat(64)),true)
 for(const mutate of [p=>delete p.isolationControls.offline.otherProgramBlocked,p=>p.isolationControls.loopback.externalBlockedIPv6=false,p=>p.status='unverified',p=>p.sha256='c'.repeat(64),p=>p.target='linux-x64',p=>p.host={version:'0.2.1',node:'26.9.0'},p=>p.isolationControls.beforeReachable=false,p=>p.isolationControls.offline.childBlocked=false,p=>p.isolationControls.loopback.loopbackAllowed=false,p=>p.checks.install=false,p=>delete p.checks.host]){const p=proof();mutate(p);assert.throws(()=>assertVerification(p,task,'b'.repeat(64)))}
})
