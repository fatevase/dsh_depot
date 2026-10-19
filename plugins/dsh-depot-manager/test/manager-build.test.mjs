import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,rm,readFile} from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import * as tar from 'tar'
const mod=await import('../build.mjs').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return{};throw e})
test('manager artifact contains built Svelte and bundled core without another host runtime',async t=>{
 assert.equal(typeof mod.buildManager,'function');const dir=await mkdtemp(path.join(os.tmpdir(),'manager-build-'));t.after(()=>rm(dir,{recursive:true,force:true}));const receipt=await mod.buildManager({target:'macos-arm64',output:dir});await mkdir(path.join(dir,'extract'));await tar.x({file:receipt.path,cwd:path.join(dir,'extract')});const root=path.join(dir,'extract/package'),pkg=JSON.parse(await readFile(path.join(root,'package.json')));assert.equal(pkg.name,'dsh-depot-manager');assert.equal(pkg.devDependencies,undefined);assert.equal(pkg.dependencies,undefined);assert.match(await readFile(path.join(root,'lib/client.js'),'utf8'),/选择文件/);assert.match(await readFile(path.join(root,'lib/index.js'),'utf8'),/connection\.fetch\.register/);assert.match(await readFile(path.join(root,'lib/manager.html'),'utf8'),/client\.js/)
})
