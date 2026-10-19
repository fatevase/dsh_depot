import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,readFile,rm,stat} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import path from 'node:path'
import {exportRepository} from '../export.mjs'
test('export preserves all workspace roots and the single authoritative dependency lock',async t=>{
 const dir=await mkdtemp(fileURLToPath(new URL('../../.runtime/export-test-',import.meta.url)));t.after(()=>rm(dir,{recursive:true,force:true}))
 const out=await exportRepository(path.join(dir,'repository'))
 const root=JSON.parse(await readFile(path.join(out,'package.json')))
 assert.deepEqual(root.workspaces,['web','plugins/*','distribution','packages/*'])
 for(const file of ['package-lock.json','web/build.mjs','plugins/dsh-depot-manager/build.mjs','packages/offline-format/package-metadata.mjs','.github/workflows/web-pages.yml'])assert.ok((await stat(path.join(out,file))).isFile())
 for(const dir of ['node_modules','.runtime','web/node_modules','distribution/node_modules'])await assert.rejects(()=>stat(path.join(out,dir)),{code:'ENOENT'})
})
