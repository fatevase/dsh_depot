import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import {realpath,mkdir,writeFile,symlink,readFile} from 'node:fs/promises'
import {temporary} from './helpers.mjs'
import {resolveExportSource} from '../core/export-source.mjs'
import {collectExportGraph} from '../core/export-dependencies.mjs'
const host={version:'0.2.0-rc.2',target:'macos-arm64',runtime:{node:'24.17.0',kind:'electron',abi:'137',napi:10}}
export async function pkg(root,name,version='1.0.0',extra={}){await mkdir(root,{recursive:true});await writeFile(path.join(root,'package.json'),JSON.stringify({name,version,...extra}));await writeFile(path.join(root,'index.js'),'module.exports=1')}
test('source uses the stock bundle resolver and checks installed identity, never a browser path',async t=>{
 const dir=await temporary(t);await pkg(dir,'dsh-depot-manager','1.0.0',{dsh:{bundle:{patch:'cordis.patch.yml'}},main:'index.js'});await writeFile(path.join(dir,'cordis.patch.yml'),'[]')
 let args;const source=await resolveExportSource({host:{...host,profileDir:'/profile',dshRoot:'/host'},bundle:{name:'dsh-depot-manager',version:'1.0.0',installed:true},resolveBundleDir:(...a)=>{args=a;return dir}})
 assert.equal(source.root,await realpath(dir));assert.deepEqual(args,['dsh','dsh-depot-manager',path.join('/host','package.json'),'/profile'])
 await assert.rejects(resolveExportSource({host,bundle:{name:'@deepseek-ai/dsh',installed:true}}),{code:'EXPORT_UNAVAILABLE'})
})
test('pnpm links, nested versions, aliases and installed workspace packages keep their own dependency context',async t=>{
 const dir=await temporary(t),root=path.join(dir,'plugin'),store=path.join(dir,'store'),a=path.join(store,'a'),b=path.join(store,'b')
 await pkg(root,'plugin','1.0.0',{dependencies:{a:'workspace:*',alias:'npm:actual@^2',lib:'^1'},optionalDependencies:{missing:'^1'},devDependencies:{mustNotRead:'*'}})
 await pkg(a,'a','1.2.0',{dependencies:{lib:'^2'}});await pkg(b,'actual','2.1.0');await pkg(path.join(a,'node_modules/lib'),'lib','2.0.0');await pkg(path.join(root,'node_modules/lib'),'lib','1.0.0')
 await symlink(a,path.join(root,'node_modules/a'),process.platform==='win32'?'junction':'dir');await symlink(b,path.join(root,'node_modules/alias'),process.platform==='win32'?'junction':'dir')
 const graph=await collectExportGraph({source:{root,name:'plugin',version:'1.0.0'},host})
 assert.deepEqual(graph.nodes.map(n=>n.manifest.name).sort(),['a','actual','lib','lib','plugin'])
 assert.equal(graph.nodes.find(n=>n.manifest.name==='a').dependencies.lib.version,'2.0.0')
 assert.ok(graph.warnings.some(w=>w.code==='OPTIONAL_DEPENDENCY_ABSENT'))
})
test('cycles and unknown peers fail explicitly while ordinary organization libraries are bundled',async t=>{
 const dir=await temporary(t),root=path.join(dir,'p');await pkg(root,'plugin','1.0.0',{dependencies:{'@deepseek-ai/schemastery':'^3'}});await pkg(path.join(root,'node_modules/@deepseek-ai/schemastery'),'@deepseek-ai/schemastery','3.18.4')
 assert.equal((await collectExportGraph({source:{root},host})).nodes.length,2)
 await pkg(root,'plugin','1.0.0',{peerDependencies:{unknown:'*'}})
 await assert.rejects(collectExportGraph({source:{root},host}),{code:'PEER_UNCONFIRMED'})
 await pkg(root,'plugin','1.0.0',{dependencies:{cycle:'*'}});await mkdir(path.join(root,'node_modules'),{recursive:true});await symlink(root,path.join(root,'node_modules/cycle'),process.platform==='win32'?'junction':'dir')
 await assert.rejects(collectExportGraph({source:{root},host}),{code:'DEPENDENCY_CYCLE_UNSUPPORTED'})
})
test('same version in different installed contexts is not deduplicated; required missing dependencies block',async t=>{
 const dir=await temporary(t),root=path.join(dir,'root');await pkg(root,'plugin','1.0.0',{dependencies:{left:'npm:contextual@1',right:'npm:contextual@1'}})
 for(const [name,version]of [['left','1.0.0'],['right','2.0.0']]){const child=path.join(root,'node_modules',name);await pkg(child,'contextual','1.0.0',{dependencies:{leaf:'*'}});await pkg(path.join(child,'node_modules/leaf'),'leaf',version)}
 const g=await collectExportGraph({source:{root},host}),instances=g.nodes.filter(n=>n.manifest.name==='contextual');assert.equal(instances.length,2);assert.deepEqual(instances.map(n=>n.dependencies.leaf.version),['1.0.0','2.0.0'])
 await pkg(root,'plugin','1.0.0',{dependencies:{missing:'1'}});await assert.rejects(collectExportGraph({source:{root},host}),{code:'MISSING_DEPENDENCY'})
})
test('source identity cannot change between public selection and graph collection',async t=>{
 const dir=await temporary(t);await pkg(dir,'plugin','2.0.0')
 await assert.rejects(collectExportGraph({source:{root:dir,name:'plugin',version:'1.0.0'},host}),{code:'SOURCE_CHANGED'})
})
