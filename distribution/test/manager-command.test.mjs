import test from 'node:test'
import assert from 'node:assert/strict'
import {runHostCommand} from '../manager/adapters/command.mjs'
test('timeout waits for actual child termination and escalates an ignored termination signal',{skip:process.platform==='win32'},async()=>{const started=performance.now();const r=await runHostCommand({executable:process.execPath,args:['-e',"process.on('SIGTERM',()=>{});setTimeout(()=>{},1500)"],cwd:process.cwd()},{timeoutMs:200});assert.equal(r.timedOut,true);assert.equal(r.exitCode,124)})
