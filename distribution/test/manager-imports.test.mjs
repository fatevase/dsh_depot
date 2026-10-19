import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm,writeFile,mkdir,readFile,symlink} from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import {gzipSync} from 'node:zlib'
import {Header} from 'tar'
import {makeFixturePackage} from '../manager/fixtures/package.mjs'
const api=await import('../manager/core/inspect.mjs').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return{};throw e})
const archives=await import('../manager/core/archive.mjs').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return{};throw e})
async function temp(t){const d=await mkdtemp(path.join(os.tmpdir(),'depot-import-'));t.after(()=>rm(d,{recursive:true,force:true}));return d}
async function raw(dir,entries){const chunks=[];for(const x of entries){const data=Buffer.from(x.data??'x'),h=new Header({path:x.path,type:x.type??'File',size:x.type==='SymbolicLink'?0:data.length,mode:420,linkpath:x.linkpath});h.encode();chunks.push(h.block);if(x.type!=='SymbolicLink')chunks.push(data,Buffer.alloc((512-data.length%512)%512))}chunks.push(Buffer.alloc(1024));const f=path.join(dir,'bad.tgz');await writeFile(f,gzipSync(Buffer.concat(chunks)));return f}
const host={target:process.platform==='darwin'?'macos-arm64':`${process.platform}-${process.arch}`,version:'0.2.0-rc.2',runtime:{node:'26.9.0',kind:'node',abi:'148',napi:10}}
test('archive inspection blocks traversal links device names collisions and live symlink parents',async t=>{
 assert.equal(typeof archives.extractSafeArchive,'function')
 const d=await temp(t)
 for(const entries of [[{path:'package/../../escape'}],[{path:'package/a',type:'SymbolicLink',linkpath:'../../outside'}],[{path:'package/CON'}],[{path:'package/File'},{path:'package/file'}],[{path:'package/link',type:'SymbolicLink',linkpath:'safe'},{path:'package/link/write'}]]){const f=await raw(d,entries);await assert.rejects(()=>archives.extractSafeArchive(f,path.join(d,'out-'+Math.random())),e=>['UNSAFE_ARCHIVE','UNSAFE_PATH','RESOURCE_LIMIT'].includes(e.code))}
})
test('archive expansion limits stop before extraction rather than trusting compressed size',async t=>{
 assert.equal(typeof archives.extractSafeArchive,'function');const d=await temp(t),f=await raw(d,[{path:'package/a',data:'123456789'}]);await assert.rejects(()=>archives.extractSafeArchive(f,path.join(d,'limit'),{unpackedBytes:8}),{code:'RESOURCE_LIMIT'})
})
test('portable folder import leaves original unchanged and blocks missing runtime closure',async t=>{
 assert.equal(typeof api.inspectArtifact,'function');const d=await temp(t),root=await makeFixturePackage(d,{archive:false});const before=await readFile(path.join(root,'package.json'),'utf8');const r=await api.inspectArtifact({path:root,host,workDir:path.join(d,'work')});assert.equal(r.packageName,'dsh-fixture');assert.equal(r.checks.dependencies,true);assert.equal(r.checks.publication,false);assert.equal(await readFile(path.join(root,'package.json'),'utf8'),before)
 await writeFile(path.join(root,'package.json'),JSON.stringify({...JSON.parse(before),dependencies:{absent:'1.0.0'}}));await assert.rejects(()=>api.inspectArtifact({path:root,host,workDir:path.join(d,'other')}),{code:'MISSING_DEPENDENCY'})
})
test('imports do not execute lifecycle scripts and unknown hashes do not inherit publication evidence',async t=>{
 assert.equal(typeof api.inspectArtifact,'function');const d=await temp(t),f=await makeFixturePackage(d,{manifest:{scripts:{postinstall:'exit 99'}}});const r=await api.inspectArtifact({path:f,host,workDir:path.join(d,'work'),trustIndex:{['0'.repeat(64)]:{verification:{status:'passed'}}}});assert.equal(r.checks.publication,false);assert.ok(r.warnings.some(x=>x.code==='UNVERIFIED_PACKAGE'))
})
test('npm CPU declarations reject incompatible runtime before installation',async t=>{
 const d=await temp(t),f=await makeFixturePackage(d,{manifest:{cpu:['arm64']}});await assert.rejects(()=>api.inspectArtifact({path:f,host:{...host,runtime:{...host.runtime,arch:'x64',platform:'linux'}},workDir:path.join(d,'cpu')}),{code:'TARGET_MISMATCH'})
})
test('native packages reject insufficient glibc even when OS and CPU match',async t=>{
 const {writePackageMetadata}=await import('../manager/core/package-metadata.mjs');const d=await temp(t),root=await makeFixturePackage(d,{archive:false});await writePackageMetadata(root,{task:{target:'linux-x64',source:{},host:{version:'0.2.0-rc.2',node:'26.9.0'},buildKey:'a'},recipe:{id:'native',probes:{native:['probe']},nativeConstraints:{libc:{name:'glibc',minimumVersion:'2.39'}}}});await assert.rejects(()=>api.inspectArtifact({path:root,host:{...host,target:'linux-x64',runtime:{...host.runtime,platform:'linux',arch:'x64',libc:{name:'glibc',version:'2.35'}}},workDir:path.join(d,'libc')}),{code:'LIBC_INCOMPATIBLE'})
})
test('file upload finish recognizes a single tgz and seals the original import session',async t=>{
 const {createImport,writeImportFile,finishImport}=await import('../manager/core/imports.mjs');const d=await temp(t),archive=await makeFixturePackage(path.join(d,'source'));const workDir=path.join(d,'uploads'),h={...host,hostId:'h'},context={workDir,hostId:'h',ownerId:'u'};const s=await createImport(context);await writeImportFile(s.importId,'download.tgz',await readFile(archive),context);const r=await finishImport(s.importId,{workDir,host:h,ownerId:'u'});assert.equal(r.packageName,'dsh-fixture');await assert.rejects(()=>writeImportFile(s.importId,'extra',Buffer.from('x'),context),{code:'IMPORT_SEALED'})
})
