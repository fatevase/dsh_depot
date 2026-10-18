import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startControlServer, isolationAdapter, checkIsolation } from '../lib/verify.mjs'
import { isolatedEnv } from '../lib/process.mjs'
import { temporary } from './helpers.mjs'
test('real platform isolation proves cold denial and loopback-only startup',async t=>{
 const dir=await temporary(t),control=await startControlServer();t.after(()=>control.close())
 const env=await isolatedEnv(dir)
 const adapter=isolationAdapter({platform:process.platform,allowCiFirewall:false})
 const probe=await checkIsolation({adapter,control,env,workDir:dir})
 if(!adapter.available){assert.equal(probe.status,'unverified');return}
 assert.equal(probe.status,'passed',JSON.stringify(probe));assert.equal(probe.beforeReachable,true);assert.equal(probe.offline.externalBlocked,true);assert.equal(probe.offline.loopbackBlocked,true);assert.equal(probe.loopback.loopbackAllowed,true);assert.equal(probe.loopback.childBlocked,true)
})

test('Windows adapter uses the native WFP guard with the requested timeout',async t=>{
 const oldCi=process.env.GITHUB_ACTIONS,oldRunner=process.env.RUNNER_ENVIRONMENT
 t.after(()=>{if(oldCi===undefined)delete process.env.GITHUB_ACTIONS;else process.env.GITHUB_ACTIONS=oldCi;if(oldRunner===undefined)delete process.env.RUNNER_ENVIRONMENT;else process.env.RUNNER_ENVIRONMENT=oldRunner})
 process.env.GITHUB_ACTIONS='true';process.env.RUNNER_ENVIRONMENT='github-hosted'
 const adapter=isolationAdapter({platform:'win32'}),dir=await temporary(t)
 const command=await adapter.command({mode:'offline',argv:['node.exe','pnpm.cjs'],timeoutMs:90000,cwd:dir,env:{}})
 assert.match(command[0],/dsh-network-guard\.exe$/);assert.deepEqual(command.slice(1),['offline','90000','node.exe','pnpm.cjs'])
})
