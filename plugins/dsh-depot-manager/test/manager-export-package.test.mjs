import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import {mkdir,writeFile,readFile,realpath,symlink} from 'node:fs/promises'
import {createRequire} from 'node:module'
import * as tar from 'tar'
import {temporary} from './helpers.mjs'
import {collectExportGraph} from '../core/export-dependencies.mjs'
import {exportInstalledPackage} from '../core/export-package.mjs'
import {auditTree} from '../core/files.mjs'
const host={version:'0.2.0-rc.2',target:'macos-arm64',runtime:{platform:'darwin',arch:'arm64',node:'24.17.0',kind:'electron',abi:'137',napi:10}}
async function fixture(dir){
 const root=path.join(dir,'source'),dependency=path.join(dir,'store/dep');await mkdir(path.join(root,'node_modules'),{recursive:true});await mkdir(dependency,{recursive:true})
 await writeFile(path.join(root,'package.json'),JSON.stringify({name:'export-fixture',version:'1.2.3',main:'index.cjs',dsh:{bundle:{patch:'cordis.patch.yml'}},dependencies:{alias:'npm:real-dep@^2'},devDependencies:{secret:'1.0.0'},scripts:{install:'exit 99',prepare:'exit 99',start:'node index.cjs'}}))
 await writeFile(path.join(root,'index.cjs'),"module.exports=require('alias')")
 await writeFile(path.join(root,'cordis.patch.yml'),'[]');await writeFile(path.join(root,'.env'),'SOURCE_SECRET=secret');await writeFile(path.join(root,'.npmrc'),'token=secret')
 await writeFile(path.join(dependency,'package.json'),JSON.stringify({name:'real-dep',version:'2.1.0',main:'index.cjs',dependencies:{'@deepseek-ai/schemastery':'file:../schema'}}))
 await writeFile(path.join(dependency,'index.cjs'),"module.exports=require('@deepseek-ai/schemastery')+1")
 const schema=path.join(dependency,'node_modules/@deepseek-ai/schemastery');await mkdir(schema,{recursive:true});await writeFile(path.join(schema,'package.json'),JSON.stringify({name:'@deepseek-ai/schemastery',version:'3.18.4',main:'index.cjs'}));await writeFile(path.join(schema,'index.cjs'),'module.exports=41')
 await symlink(dependency,path.join(root,'node_modules/alias'),process.platform==='win32'?'junction':'dir')
 return {root:await realpath(root),name:'export-fixture',version:'1.2.3'}
}
test('actual archive preserves nested runtime resolution, excludes configuration and rewrites install declarations',async t=>{
 const dir=await temporary(t),source=await fixture(dir),before=await auditTree(source.root,{exclude:['node_modules']}),graph=await collectExportGraph({source,host})
 const result=await exportInstalledPackage({graph,host,workDir:path.join(dir,'output')});assert.equal(result.fileName,'export-fixture-1.2.3-macos-arm64.tgz')
 const extracted=path.join(dir,'extracted');await mkdir(extracted);await tar.x({file:result.path,cwd:extracted});const root=path.join(extracted,'package'),p=JSON.parse(await readFile(path.join(root,'package.json')))
 assert.equal(createRequire(path.join(root,'package.json'))('./index.cjs'),42)
 assert.deepEqual(p.dependencies,{alias:'npm:real-dep@2.1.0'});assert.deepEqual(p.bundleDependencies,['alias']);assert.deepEqual(p.scripts,{start:'node index.cjs'});assert.equal(p.devDependencies,undefined)
 const files=await auditTree(root);assert.equal(files.some(f=>/\.env|\.npmrc|secret/.test(f.path)),false);assert.equal(files.some(f=>f.type==='symlink'),false)
 assert.deepEqual(await auditTree(source.root,{exclude:['node_modules']}),before)
 const metadata=JSON.parse(await readFile(path.join(root,'depot-manifest.json')));assert.equal(metadata.source.type,'local-export');assert.deepEqual(metadata.compatibility.testedEnvironments,[]);assert.equal(JSON.stringify(metadata).includes(source.root),false)
 assert.equal(result.inspection.checks.integrity,true);assert.equal(result.inspection.checks.publication,false);assert.equal(result.inspection.warnings.some(w=>w.code==='LOCAL_EXPORT'),true)
})
test('source changes, external asset links and total resource limits block export',async t=>{
 const dir=await temporary(t),source=await fixture(dir),graph=await collectExportGraph({source,host})
 await writeFile(path.join(source.root,'index.cjs'),'changed')
 await assert.rejects(exportInstalledPackage({graph,host,workDir:path.join(dir,'changed')}),{code:'SOURCE_CHANGED'})
 await assert.rejects(collectExportGraph({source,host,limits:{unpackedBytes:8}}),{code:'RESOURCE_LIMIT'})
 await symlink(path.join(dir,'store'),path.join(source.root,'outside'),process.platform==='win32'?'junction':'dir')
 await assert.rejects(collectExportGraph({source,host}),{code:'NONPORTABLE_DEPENDENCY'})
})
test('native exports conservatively constrain ABI and never invent target validation',async t=>{
 const dir=await temporary(t),source=await fixture(dir);await writeFile(path.join(source.root,'binding.node'),'fixture-not-loaded')
 const result=await exportInstalledPackage({graph:await collectExportGraph({source,host}),host,workDir:path.join(dir,'output')})
 assert.equal(result.inspection.metadata.native.nodeAbi,'137');assert.deepEqual(result.inspection.metadata.native.runtimeKinds,['electron']);assert.deepEqual(result.inspection.metadata.compatibility.testedEnvironments,[])
})
