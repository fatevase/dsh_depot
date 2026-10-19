import test from 'node:test'
import assert from 'node:assert/strict'
import {fixture} from './manager-helpers.mjs'
const mod=await import('../manager/plugin/host/api.mjs').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return{};throw e})
test('API binds environment and user; only actual top-level bundles can be removed',async t=>{
 assert.equal(typeof mod.createManagerApi,'function');const f=await fixture(t);const api=mod.createManagerApi({host:f.host,ownerId:'operator',storeDir:f.dir,listBundles:async()=>[{name:'plugin',version:'1',installed:true,removable:true,rows:[{rowId:'p'}]},{name:'core',installed:false,removable:false,rows:[]}]});
 await assert.rejects(()=>api.invoke('environment.current',{},'outsider'),{code:'FORBIDDEN'});const host=await api.invoke('environment.current',{profileDir:'/other'},'operator');assert.equal(host.hostId,f.host.hostId);assert.equal(host.profileDir,undefined);const rows=await api.invoke('installed.list',{},'operator');assert.equal(rows.length,2);assert.equal(rows[1].protected,true);await assert.rejects(()=>api.invoke('plans.create',{action:'remove',packageName:'core'},'operator'),{code:'PROTECTED_PACKAGE'});const imported=await api.invoke('imports.create',{},'operator');await assert.rejects(()=>api.invoke('imports.finish',{importId:imported.importId},'outsider'),{code:'FORBIDDEN'})
})
test('current environment exposes the canonical product target',async t=>{const f=await fixture(t);f.host.target='macos-arm64';const api=mod.createManagerApi({host:f.host,ownerId:'operator',storeDir:f.dir,listBundles:async()=>[]});assert.equal((await api.invoke('environment.current',{},'operator')).runtimeTarget,'macos-arm64')})
