import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdir,writeFile,readFile} from 'node:fs/promises'
import path from 'node:path'
import {fixture} from './manager-helpers.mjs'
import {createOperationPlan} from '../core/plans.mjs'
import {executePlan} from '../core/operations.mjs'
const {liveInstallAdapter}=await import('../plugin/host/live-install.mjs').catch(()=>({}))
test('plugin UI installs via the running DSH package service with offline flags and no external CLI',async t=>{
 assert.equal(typeof liveInstallAdapter,'function');const f=await fixture(t);let activated=false
 await writeFile(path.join(f.profile,'node_modules/.modules.yaml'),'storeDir: /custom/existing-store/v11\npackageManager: pnpm@11.25.0\n')
 const carrier={command:'/desktop/node',args:['/desktop/runner','/desktop/pnpm'],env:{ELECTRON_RUN_AS_NODE:'1',HOST_MARKER:'kept'}};f.host.packageManager=carrier
 // Real Desktop profiles may lack a second installed snapshot. The live path
 // must still enforce the same pure-offline policy as the external CLI.
 await writeFile(path.join(f.profile,'pnpm-lock.yaml'),"lockfileVersion: '9.0'\npackages: {}\n")
 let locked=false;const adapter=liveInstallAdapter({loadAtomic:async()=>({withFileLock:async(file,fn)=>{assert.equal(file,path.join(f.profile,'package.json'));locked=true;try{return await fn()}finally{locked=false}}}),profile:{name:'desktop',dir:f.profile,home:f.dir,installAnchor:path.join(f.dir,'host/package.json'),packageManager:carrier},pluginManager:{setBundleEnabled:async(name,on)=>{assert.equal(locked,false,'activation must happen after releasing the profile lock');assert.equal(name,'new-plugin');assert.equal(on,true);activated=true;return{application:'restart-required',changed:true}}},loadOperations:async()=>({runProfilePnpm:async(profile,args,options)=>{
  assert.equal(locked,true,'pnpm must hold the same profile lock as DSH');assert.equal(profile.profile,'desktop');assert.equal(options.command,carrier.command);assert.deepEqual(options.args,carrier.args);assert.equal(options.env.HOST_MARKER,'kept');assert.equal(options.env.npm_config_offline,'true');assert.ok(args.includes('--config.trust-lockfile=true'));assert.ok(args.includes('--offline'));assert.ok(args.includes('--ignore-scripts'));assert.equal(args[args.indexOf('--store-dir')+1],'/custom/existing-store/v11')
  const p=JSON.parse(await readFile(path.join(f.profile,'package.json')));p.dependencies['new-plugin']='file:'+f.inspection.archivePath;await writeFile(path.join(f.profile,'package.json'),JSON.stringify(p));await mkdir(path.join(f.profile,'node_modules/new-plugin'));await writeFile(path.join(f.profile,'node_modules/new-plugin/package.json'),JSON.stringify({name:'new-plugin',version:'1.0.0'}));return{exitCode:0,output:'installed'}
 }})})
 const plan=await createOperationPlan({host:f.host,inspection:f.inspection,action:'install'}),op=await executePlan(plan,{host:f.host,adapter,storeDir:path.join(f.dir,'state')})
 assert.equal(op.state,'awaiting_reload');assert.equal(activated,true);assert.equal(await readFile(path.join(f.profile,'node_modules/old/index.js'),'utf8'),'old content')
})
test('failed running-host install stays failed and never enables the plugin',async t=>{
 assert.equal(typeof liveInstallAdapter,'function');const f=await fixture(t);let activated=false
 let locked=false;const adapter=liveInstallAdapter({loadAtomic:async()=>({withFileLock:async(file,fn)=>{assert.equal(file,path.join(f.profile,'package.json'));locked=true;try{return await fn()}finally{locked=false}}}),profile:{name:'web',dir:f.profile,installAnchor:path.join(f.dir,'host/package.json')},pluginManager:{setBundleEnabled:async()=>{activated=true}},loadOperations:async()=>({runProfilePnpm:async()=>({exitCode:1,output:'missing offline metadata'})})})
 const plan=await createOperationPlan({host:f.host,inspection:f.inspection,action:'install'}),op=await executePlan(plan,{host:f.host,adapter,storeDir:path.join(f.dir,'state')})
 assert.equal(op.state,'failed');assert.equal(activated,false);assert.match(op.error.message,/missing offline metadata/)
})
