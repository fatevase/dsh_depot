import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import os from 'node:os'
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises'
import {desktopPackageManager} from '../adapters/host-pnpm.mjs'

test('Desktop pnpm uses the installation helper including its lock recovery runner',async t=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'host-pnpm-'));t.after(()=>rm(dir,{recursive:true,force:true}))
 const resources=path.join(dir,'resources'),runtimeRoot=path.join(resources,'app')
 const entry=path.join(runtimeRoot,'node_modules/pnpm/bin/pnpm.mjs'),runner=path.join(runtimeRoot,'node_modules/dsh-desktop-market-installer/pnpm-runner.mjs')
 for(const p of [entry,runner]){await mkdir(path.dirname(p),{recursive:true});await writeFile(p,'// fixture')}
 await writeFile(path.join(resources,'packaged-pnpm-invocation.mjs'),`export function buildPackagedPnpmInvocation(env,executable){return {command:executable,args:[env.DSH_DESKTOP_PNPM_RUNNER,env.DSH_DESKTOP_PNPM_ENTRY],env:{ELECTRON_RUN_AS_NODE:'1'}}}`)
 await writeFile(path.join(resources,'harness-node-entry.mjs'),'// installed harness fixture')
 assert.deepEqual(await desktopPackageManager({resources,runtimeRoot},{nodePath:process.execPath}),{command:process.execPath,args:[runner,entry],env:{ELECTRON_RUN_AS_NODE:'1'}})
 await rm(runner)
 await assert.rejects(desktopPackageManager({resources,runtimeRoot},{nodePath:process.execPath}),{code:'HOST_PACKAGE_MANAGER_UNAVAILABLE'})
})
