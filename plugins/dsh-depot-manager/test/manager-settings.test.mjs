import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,writeFile,rm} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
const api=await import('../bootstrap/settings.mjs').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return{};throw e})
test('editable JSON supplies literal host paths without evaluating commands or using installer Node as host',async t=>{assert.equal(typeof api.readDiscoverySettings,'function');const root=await mkdtemp(path.join(os.tmpdir(),'manager-settings-'));t.after(()=>rm(root,{recursive:true,force:true}));const file=path.join(root,'settings.json'),home=path.join(root,'Data & ! space'),desktop=path.join(root,'Custom Desktop.app');await writeFile(file,'\ufeff'+JSON.stringify({schemaVersion:1,dshHome:home,dshRoot:'',hostNode:'',desktopApp:desktop,searchPaths:[]}));const result=await api.readDiscoverySettings(root,{PATH:'/system',DSH_HOME:'/old'});assert.equal(result.env.DSH_HOME,home);assert.equal(result.env.PATH,'/system');assert.equal(result.env.DSH_DEPOT_NODE,undefined);assert.deepEqual(result.paths,[desktop]);await writeFile(file,'{"schemaVersion":1,"searchPaths":["relative/path"]}');await assert.rejects(()=>api.readDiscoverySettings(root,{}),{code:'INVALID_SETTINGS'});await writeFile(file,'not JSON');await assert.rejects(()=>api.readDiscoverySettings(root,{}),{code:'INVALID_SETTINGS'})})
