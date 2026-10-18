import { hostEnvironmentDigest } from '../lib/host-environment.mjs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
export const sha = char => char.repeat(40)
export const recipe = (overrides = {}) => ({schemaVersion:1,id:'fixture',repository:'fixture/plugin',packagePath:'.',npmName:'dsh-fixture',channel:{type:'tags',allowPrerelease:false},allowedVersions:'*',hostRange:'^0.2.0-rc.1',targets:['macos-arm64','linux-x64','win32-x64'],toolchain:{node:'26.9.0',npm:'11.19.1',pnpm:'11.25.0'},locks:{build:{file:'package-lock.json'},runtime:{digest:'a'.repeat(64)}},buildCommands:[['npm','run','build']],packageRules:{localPackages:[]},probes:{clientModule:'dsh-fixture'},enabled:true,...overrides})
export const source = (overrides = {}) => ({recipeId:'fixture',repository:'fixture/plugin',ref:'v1.0.0',commit:sha('a'),version:'1.0.0',manifestDigest:'b'.repeat(64),lockDigests:{'package-lock.json':'c'.repeat(64)},peerDependencies:{'@deepseek-ai/dsh':'^0.2.0-rc.1'},...overrides})
export const host = {environmentDigest:hostEnvironmentDigest(),version:'0.2.0-rc.2',node:'26.9.0'}
export async function temporary(t){const dir=await mkdtemp(path.join(tmpdir(),'depot-test-'));t.after(()=>rm(dir,{recursive:true,force:true}));return dir}
