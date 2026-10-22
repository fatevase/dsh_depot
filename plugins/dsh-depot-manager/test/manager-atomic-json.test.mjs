import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs/promises'
import {syncBuiltinESMExports} from 'node:module'
import {atomicJson,readJson} from '../core/files.mjs'
async function fixture(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'depot-json-busy-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const file=path.join(root,'job.json');await atomicJson(file,{state:'before'});return{root,file}}
// Simulate the Windows filesystem sharing boundary; actual writes/renames remain real.
for(const code of ['EPERM','EACCES','EBUSY'])test(`atomic JSON survives transient Windows ${code} without deleting the old record`,async t=>{
 const f=await fixture(t),original=fs.rename,platform=Object.getOwnPropertyDescriptor(process,'platform');let failures=2
 Object.defineProperty(process,'platform',{value:'win32'})
 fs.rename=async(from,to)=>{if(failures-->0){assert.deepEqual(await readJson(f.file),{state:'before'});throw Object.assign(Error('temporary sharing violation'),{code})}return original(from,to)};syncBuiltinESMExports()
 try{await atomicJson(f.file,{state:'after'})}finally{fs.rename=original;syncBuiltinESMExports();Object.defineProperty(process,'platform',platform)}
 assert.deepEqual(await readJson(f.file),{state:'after'});assert.deepEqual(await fs.readdir(f.root),['job.json'])
})
test('persistent Windows rename failure preserves the record and removes only its temporary file',async t=>{
 const f=await fixture(t),original=fs.rename,platform=Object.getOwnPropertyDescriptor(process,'platform'),error=Object.assign(Error('permission denied'),{code:'EACCES'})
 Object.defineProperty(process,'platform',{value:'win32'});fs.rename=async()=>{throw error};syncBuiltinESMExports()
 try{await assert.rejects(atomicJson(f.file,{state:'after'}),e=>e===error)}finally{fs.rename=original;syncBuiltinESMExports();Object.defineProperty(process,'platform',platform)}
 assert.deepEqual(await readJson(f.file),{state:'before'});assert.deepEqual(await fs.readdir(f.root),['job.json'])
})
test('Windows replacement waits for a real sharing lock to be released',{skip:process.platform!=='win32'},async t=>{
 const {spawn}=await import('node:child_process'),{once}=await import('node:events'),f=await fixture(t)
 const release=path.join(f.root,'release'),script="$ErrorActionPreference='Stop'; $s=[IO.File]::Open($env:DEPOT_BUSY_JSON,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::ReadWrite); try { [Console]::Out.WriteLine('locked'); while (-not [IO.File]::Exists($env:DEPOT_BUSY_RELEASE)) { Start-Sleep -Milliseconds 10 } } finally { $s.Dispose() }"
 const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{env:{...process.env,DEPOT_BUSY_JSON:f.file,DEPOT_BUSY_RELEASE:release},stdio:['ignore','pipe','pipe']})
 t.after(()=>{if(child.exitCode===null)child.kill()})
 let out='';await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>reject(Error('lock helper exited early '+code)));child.stdout.on('data',b=>{out+=b;if(out.includes('locked'))resolve()})})
 const exited=once(child,'exit'),timer=setTimeout(()=>fs.writeFile(release,'release').catch(()=>{}),100);t.after(()=>clearTimeout(timer))
 await atomicJson(f.file,{state:'after'});await exited
 assert.deepEqual(await readJson(f.file),{state:'after'})
})
