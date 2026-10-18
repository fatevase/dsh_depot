import assert from 'node:assert/strict'
import path from 'node:path'
import { mkdir,writeFile,readFile } from 'node:fs/promises'
import { lookup } from 'node:dns/promises'
import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { startControlServer,checkIsolation } from '../lib/verify.mjs'
import { isolatedEnv,runCommand } from '../lib/process.mjs'
import { connect } from '../lib/network-probe.mjs'
const workDir=path.resolve('.runtime/distribution/windows-probe');await mkdir(workDir,{recursive:true})
const guard=path.resolve('.runtime/distribution/isolation/dsh-network-guard.exe')
const control=await startControlServer(),env={...await isolatedEnv(path.join(workDir,'environment')),GITHUB_ACTIONS:'true',RUNNER_ENVIRONMENT:'github-hosted'}
const adapter={platform:'win32',available:true,run:options=>runCommand({...options,argv:[guard,options.mode,String(options.timeoutMs??45000),...options.argv],timeoutMs:(options.timeoutMs??45000)+10000})}
try{
 const report=await checkIsolation({adapter,control,env,workDir})
 const remote={address:(await lookup('api.github.com',{family:4})).address,port:443}
 const remoteDir=path.join(workDir,'external');await mkdir(remoteDir,{recursive:true})
 report.external=await checkIsolation({adapter,control:remote,env,workDir:remoteDir})
 assert.equal(report.external.status,'passed',JSON.stringify(report.external))
 const timed=await adapter.run({mode:'offline',argv:[process.execPath,'-e','setInterval(()=>{},1000)'],timeoutMs:1200,cwd:workDir,env,logFile:path.join(workDir,'timeout.log')})
 assert.equal(timed.exitCode,124)
 assert.equal(await connect(control.address,control.port),true,'Network must recover after timeout')
 const failed=await adapter.run({mode:'offline',argv:[path.join(workDir,'missing.exe')],cwd:workDir,env,logFile:path.join(workDir,'failed-start.log')})
 assert.equal(failed.exitCode,125)
 assert.equal(await connect(control.address,control.port),true,'Network must recover after failed start')
 const pidFile=path.join(workDir,'child.pid')
 const crashing=spawn(guard,['offline','30000',process.execPath,'-e',`require('fs').writeFileSync(${JSON.stringify(pidFile)},String(process.pid));setInterval(()=>{},1000)`],{env,cwd:workDir,stdio:'ignore'})
 try{
  let childPid
  for(let i=0;i<100;i++){try{childPid=+(await readFile(pidFile,'utf8'));break}catch{}await delay(50)}
  assert.ok(childPid,'Guarded child must start before forced helper termination')
  process.kill(crashing.pid)
  await new Promise(resolve=>crashing.once('close',resolve))
  for(let i=0;i<50;i++){try{process.kill(childPid,0)}catch{childPid=undefined;break}await delay(50)}
  assert.equal(childPid,undefined,'Guarded process must die with the job owner')
  assert.equal(await connect(control.address,control.port),true,'Dynamic session must restore network after helper termination')
 }finally{try{crashing.kill()}catch{}}
 report.cleanup={timeout:true,failedStart:true,ownerTermination:true}
 report.afterReachable=await connect(control.address,control.port)
 await writeFile(path.join(workDir,'isolation.json'),JSON.stringify(report,null,2)+'\n')
 console.log(JSON.stringify(report));assert.equal(report.status,'passed');assert.equal(report.afterReachable,true)
}finally{await control.close()}
