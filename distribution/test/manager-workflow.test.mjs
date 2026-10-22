import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {temporary} from './helpers.mjs'
import {exportRepository} from '../export.mjs'
import path from 'node:path'
test('manager workflow builds on native runners without PR write authority',async()=>{const w=JSON.parse(await readFile(new URL('../../.github/workflows/manager-distribution.yml',import.meta.url)));assert.deepEqual(w.permissions,{});assert.equal(w.jobs.build.permissions.contents,'read');assert.equal(w.jobs.build.strategy['fail-fast'],false);assert.deepEqual(w.jobs.build.strategy.matrix.include.map(x=>x.target),['macos-arm64','linux-x64','win32-x64']);assert.ok(w.jobs.publish.if.includes("workflow_dispatch"));assert.ok(w.jobs.publish.if.includes("github.event_name == 'push'"));assert.ok(w.jobs.publish.steps.some(s=>s.run?.includes("github.event_name == 'push' && 'preview' || inputs.channel || 'stable'")));assert.ok(w.jobs.publish.if.includes('always()'));assert.ok(w.jobs.publish.if.includes('inputs.publish'));assert.ok(w.jobs.publish.if.includes('default_branch'));assert.equal(w.jobs.publish.permissions.contents,'write');assert.ok(!JSON.stringify(w.jobs.build).includes('secrets.'))})
