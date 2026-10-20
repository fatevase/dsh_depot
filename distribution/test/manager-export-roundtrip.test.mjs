import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import {readFile} from 'node:fs/promises'
import {temporary} from './helpers.mjs'
import {createExportFixture} from '../manager/export-roundtrip.mjs'
import {collectExportGraph} from '../../plugins/dsh-depot-manager/core/export-dependencies.mjs'
test('real migration fixture has nested runtime versions and a plugin registration, never profile data',async t=>{
 const dir=await temporary(t),source=await createExportFixture(dir),graph=await collectExportGraph({source,host:{version:'0.2.0-rc.2',target:'macos-arm64',runtime:{node:process.versions.node}}})
 assert.equal(graph.nodes.filter(n=>n.manifest.name==='export-leaf').length,2)
 assert.ok((await readFile(path.join(source.root,'cordis.patch.yml'),'utf8')).includes('depot-export-fixture'))
 assert.ok(graph.exclusions.some(e=>e.path==='.env'))
})
