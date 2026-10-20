import test from 'node:test'
import assert from 'node:assert/strict'
import {fixture} from './manager-helpers.mjs'
const mod=await import('../plugin/host/api.mjs').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return{};throw e})
test('API binds environment and user; only actual top-level bundles can be removed',async t=>{
 assert.equal(typeof mod.createManagerApi,'function');const f=await fixture(t);const api=mod.createManagerApi({host:f.host,ownerId:'operator',storeDir:f.dir,listBundles:async()=>[{name:'plugin',version:'1',installed:true,removable:true,rows:[{rowId:'p'}]},{name:'core',installed:false,removable:false,rows:[]}]});
 await assert.rejects(()=>api.invoke('environment.current',{},'outsider'),{code:'FORBIDDEN'});const host=await api.invoke('environment.current',{profileDir:'/other'},'operator');assert.equal(host.hostId,f.host.hostId);assert.equal(host.profileDir,undefined);const rows=await api.invoke('installed.list',{},'operator');assert.equal(rows.length,2);assert.equal(rows[1].protected,true);await assert.rejects(()=>api.invoke('plans.create',{action:'remove',packageName:'core'},'operator'),{code:'PROTECTED_PACKAGE'});const imported=await api.invoke('imports.create',{},'operator');await assert.rejects(()=>api.invoke('imports.finish',{importId:imported.importId},'outsider'),{code:'FORBIDDEN'})
})
test('current environment exposes the canonical product target',async t=>{const f=await fixture(t);f.host.target='macos-arm64';const api=mod.createManagerApi({host:f.host,ownerId:'operator',storeDir:f.dir,listBundles:async()=>[]});assert.equal((await api.invoke('environment.current',{},'operator')).runtimeTarget,'macos-arm64')})
test('exports preserve owner authorization and manager self-export differs from self-uninstall',async t=>{
 const f=await fixture(t),calls=[],exports={create:async x=>{calls.push(x);return{exportId:'export1'}},list:async()=>[],status:async id=>({exportId:id}),cancel:async id=>({exportId:id,state:'cancelled'}),dispose:async()=>{}}
 const api=mod.createManagerApi({host:f.host,ownerId:'owner',storeDir:f.dir,listBundles:async()=>[{name:'dsh-depot-manager',version:'0.1.7',installed:true,enabled:true,removable:true},{name:'@deepseek-ai/dsh-plugin-manager',installed:true},{name:'broken',installed:true,error:{code:'MISSING'}}],exportService:exports})
 const rows=await api.invoke('installed.list',{},'owner');assert.equal(rows[0].protected,true);assert.equal(rows[0].exportable,true);assert.equal(rows[1].exportable,false);assert.match(rows[2].exportReason,/无法/)
 await assert.rejects(api.invoke('exports.create',{packageName:'dsh-depot-manager'},'other'),{code:'FORBIDDEN'})
 assert.equal((await api.invoke('exports.create',{packageName:'dsh-depot-manager',installedFingerprint:rows[0].fingerprint},'owner')).exportId,'export1');assert.equal(calls.length,1)
 await assert.rejects(api.invoke('exports.create',{packageName:'x',path:'/somewhere'},'owner'),{code:'INVALID_REQUEST'})
 await api.dispose()
})
