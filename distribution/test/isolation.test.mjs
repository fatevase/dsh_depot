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
