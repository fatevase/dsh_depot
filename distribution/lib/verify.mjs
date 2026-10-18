import assert from 'node:assert/strict'
import net from 'node:net'
import os from 'node:os'
import { existsSync } from 'node:fs'
import { mkdir, copyFile, writeFile, realpath, readFile, mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { randomUUID } from 'node:crypto'
import { parseDocument } from 'yaml'
import { atomicJson, readJson, fileDigest } from './model.mjs'
import { hostEnvironmentDigest } from './host-environment.mjs'
import { isolatedEnv, runCommand, prepareTools } from './process.mjs'
import { connect } from './network-probe.mjs'
import { sandboxProfile } from '../isolation/macos.mjs'
const directory = path.dirname(fileURLToPath(import.meta.url))
export function assertVerification(v, task, sha256, recipe) {
  assert.equal(v.schemaVersion, 1); assert.equal(v.status, 'passed'); assert.equal(v.buildKey, task.buildKey); assert.equal(v.target, task.target); assert.deepEqual(v.host, task.host); assert.equal(v.sha256, sha256)
  const c = v.isolationControls
  assert.equal(c?.beforeReachable, true); assert.equal(c?.beforeReachableIPv6, true)
  for (const mode of ['offline', 'loopback']) { assert.equal(c?.[mode]?.externalBlocked, true); assert.equal(c?.[mode]?.childBlocked, true); assert.equal(c?.[mode]?.externalBlockedIPv6, true); assert.equal(c?.[mode]?.childBlockedIPv6, true); assert.equal(c?.[mode]?.otherProgramBlocked, true) }
  assert.equal(c.offline.loopbackBlocked, true); assert.equal(c.loopback.loopbackAllowed, true)
  for (const check of ['install', 'compose', 'host', 'native']) assert.equal(v.checks?.[check], true)
  const probes=recipe?.probes??{clientModule:'legacy'}
  assert.ok(probes.clientModule || probes.registrations?.length,'Recipe has no plugin registration probe')
  if(probes.clientModule)assert.equal(v.checks?.clientModule,true)
  if(probes.registrations?.length){assert.equal(v.checks?.registration,true);assert.deepEqual(v.registrationEvidence,probes.registrations)}
  return true
}
export function registrationEvidenceOf(text,expected=[]){
  if(!expected.length)return []
  const document=parseDocument(text,{logLevel:'silent'})
  if(document.errors.length)throw Error('Cannot parse stock DSH composition for registration evidence')
  const rows=document.toJS()
  if(!Array.isArray(rows))throw Error('Expected stock DSH configuration rows')
  return expected.map(wanted=>{
    const found=rows.find(row=>row?.id===wanted.id&&row.name===wanted.name&&(row.disabled===undefined||row.disabled===false))
    if(!found)throw Error(`Declared plugin registration missing or disabled: ${wanted.id}`)
    return {id:found.id,name:found.name}
  })
}
export async function startControlServer() {
  const entry = Object.values(os.networkInterfaces()).flat().find(i => i?.family === 'IPv4' && !i.internal)
  if (!entry) throw new Error('No non-loopback interface for positive network control')
  const server = net.createServer(socket => socket.end())
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, entry.address, resolve) })
  return { address: entry.address, port: server.address().port, close: () => new Promise(resolve => server.close(resolve)) }
}
export function isolationAdapter({ platform = process.platform, allowCiFirewall = true } = {}) {
  const available = platform === 'darwin' ? existsSync('/usr/bin/sandbox-exec') : platform === 'linux' ? existsSync('/usr/bin/unshare') : platform === 'win32' && allowCiFirewall && process.env.GITHUB_ACTIONS === 'true' && process.env.RUNNER_ENVIRONMENT === 'github-hosted'
  return { available, platform, async command({ mode, argv, cwd, env, timeoutMs = 45000, logFile }) {
    if (!available) throw new Error('Network isolation unavailable')
    let command
    if (platform === 'darwin') { const profile = path.join(cwd, `${mode}-${randomUUID()}.sb`); await writeFile(profile, sandboxProfile(mode)); command = ['/usr/bin/sandbox-exec', '-f', profile, ...argv] }
    else if (platform === 'linux') {
      const runner = [process.execPath, fileURLToPath(new URL('../isolation/linux.mjs', import.meta.url)), '--run', mode, ...(process.env.GITHUB_ACTIONS === 'true' && process.env.RUNNER_ENVIRONMENT === 'github-hosted' ? ['--as-user',String(process.getuid()),String(process.getgid())] : []), ...argv]
      command = process.env.GITHUB_ACTIONS === 'true' && process.env.RUNNER_ENVIRONMENT === 'github-hosted' ? ['/usr/bin/sudo', '-n', '/usr/bin/unshare', '-n', '--', '/usr/bin/env', '-i', ...Object.entries(env).map(([k,v]) => `${k}=${v}`), ...runner] : ['/usr/bin/unshare', '-Urn', '--', ...runner]
    }
    else { command = [fileURLToPath(new URL('../../.runtime/distribution/isolation/dsh-network-guard.exe',import.meta.url)),mode,String(timeoutMs),...argv] }
    return command
  }, async run(options) {
    const command = await this.command(options), { cwd, env, timeoutMs = 45000, logFile } = options
    return runCommand({ argv: command, cwd, env: platform === 'win32' ? { ...env, GITHUB_ACTIONS: process.env.GITHUB_ACTIONS, RUNNER_ENVIRONMENT: process.env.RUNNER_ENVIRONMENT } : env, timeoutMs: timeoutMs + 5000, logFile })
  } }
}
export async function checkIsolation({ adapter, control, env, workDir }) {
  const result = { status: 'unverified', beforeReachable: await connect(control.address, control.port), beforeReachableIPv6: await connect(`::ffff:${control.address}`, control.port) }
  if (!adapter.available || !result.beforeReachable) return result
  for (const mode of ['offline', 'loopback']) {
    const observerFile = adapter.platform === 'darwin' && mode === 'loopback' ? path.join(workDir, 'inbound-control') : undefined
    const running = adapter.run({ mode, argv: [process.execPath, path.join(directory, 'network-probe.mjs'), '--probe', control.address, String(control.port), ...(observerFile ? [observerFile] : [])], cwd: workDir, env, logFile: path.join(workDir, `control-${mode}.log`) })
    let observed = false
    if (observerFile) { for (let i = 0; i < 80; i++) { try { const port = await readFile(observerFile, 'utf8'); observed = await connect('127.0.0.1', +port); await writeFile(observerFile + '.done', 'done'); break } catch {} await delay(100) } }
    const command = await running
    if (command.exitCode) { result.error = command.output; return result }
    try { result[mode] = JSON.parse(command.output.trim()) } catch { return result }
    if (observerFile) { result[mode].loopbackAllowed = observed; result[mode].observer = 'outside-sandbox-inbound-only'; result[mode].outboundLoopbackBlocked = result[mode].loopbackBlocked }
  }
  if (result.beforeReachableIPv6 && result.offline.externalBlockedIPv6 && result.loopback.externalBlockedIPv6 && result.offline.childBlockedIPv6 && result.loopback.childBlockedIPv6 && result.offline.otherProgramBlocked && result.loopback.otherProgramBlocked && result.offline.externalBlocked && result.offline.childBlocked && result.offline.loopbackBlocked && result.loopback.externalBlocked && result.loopback.childBlocked && result.loopback.loopbackAllowed) result.status = 'passed'
  return result
}
export async function prepareHost({ hostVersion = '0.2.0-rc.2', workDir, tools, dshBin, environmentDigest = hostEnvironmentDigest() } = {}) {
  if(environmentDigest !== hostEnvironmentDigest())throw new Error('Host configuration changed after planning')
  if (dshBin) {
    const bin=await realpath(dshBin),manifest=await readJson(path.resolve(bin,'../../package.json'))
    if(manifest.version!==hostVersion)throw new Error('Stock host version mismatch')
    let graph=path.dirname(bin)
    while(true){const pkg=await readJson(path.join(graph,'package.json'),{});if(pkg.name==='dsh-distribution-verification-host')break;const parent=path.dirname(graph);if(parent===graph)throw new Error('Existing host has no approved frozen environment');graph=parent}
    if(hostEnvironmentDigest(graph)!==environmentDigest)throw new Error('Installed host graph differs from plan')
    return {dshBin:bin,root:path.resolve(bin,'../..'),version:manifest.version,environmentDigest,preparedFrom:'approved-frozen-stock-host'}
  }
  workDir = path.resolve(workDir); await mkdir(workDir, { recursive: true })
  for (const file of ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml']) await copyFile(path.join(directory, '../host', file), path.join(workDir, file))
  tools ??= await prepareTools({ node: process.versions.node, npm: '11.19.1', pnpm: '11.25.0' }, path.join(workDir, 'tools'))
  const env = await isolatedEnv(path.join(workDir, 'environment'), { bin: tools.bin })
  const installed = await runCommand({ argv: [...tools.pnpm, 'install', '--frozen-lockfile', '--ignore-scripts', '--config.manage-package-manager-versions=false', '--store-dir', path.join(workDir, 'store')], cwd: workDir, env, logFile: path.join(workDir, 'prepare-host.log') })
  if (installed.exitCode) throw new Error(`Host preparation failed: ${installed.output.slice(-1500)}`)
  return prepareHost({ hostVersion, environmentDigest, dshBin: path.join(workDir, 'node_modules/@deepseek-ai/dsh/lib/bin.js') })
}
export async function verifyArtifact({ task, recipe, artifact, host, workDir, isolation = isolationAdapter() }) {
  workDir = path.join(path.resolve(workDir), randomUUID()); await mkdir(workDir, { recursive: true })
  const verification = { schemaVersion: 1, buildKey: task.buildKey, target: task.target, host: task.host, sha256: artifact.sha256, status: 'unverified', timings: {}, checks: {}, scope: ['cold-install', 'config-compose', 'host-page-smoke', ...(recipe.probes.registrations?.length?['config-registration']:[]),...(recipe.probes.skillFiles?.length?['bundled-skill-files']:[]), ...(recipe.probes.native?.length ? ['native-load'] : [])], workDir }
  let control, profileHome
  try {
    if (task.target !== `${process.platform}-${process.arch}` || task.host.node !== process.versions.node || host.version !== task.host.version || host.environmentDigest !== task.host.environmentDigest || task.host.environmentDigest !== hostEnvironmentDigest()) throw new Error('Verifier environment differs from plan')
    if (await fileDigest(artifact.package) !== artifact.sha256) throw new Error('Artifact checksum mismatch')
    const tools = await prepareTools({ node: task.host.node, npm: '11.19.1', pnpm: '11.25.0' }, path.resolve(workDir, '../../../verification-tools'))
    const env = await isolatedEnv(path.join(workDir, 'environment'), { bin: tools.bin })
    env.DSH_HOME = profileHome = await mkdtemp(path.join(os.tmpdir(), 'dsh-depot-profile-')); env.npm_config_manage_package_manager_versions = 'false'
    const profile = path.join(env.DSH_HOME, 'profiles/web'); await mkdir(profile, { recursive: true })
    await writeFile(path.join(profile, 'pnpm-workspace.yaml'), 'packages:\n  - .\nnodeLinker: hoisted\nautoInstallPeers: false\n')
    control = await startControlServer()
    verification.isolationControls = await checkIsolation({ adapter: isolation, control, env, workDir })
    if (verification.isolationControls.status !== 'passed') throw new Error('Network isolation controls failed')
    verification.status = 'failed'
    const installed = await isolation.run({ mode: 'offline', argv: [process.execPath, host.dshBin, 'plugin', '--profile', 'web', 'add', artifact.package, '--offline', '--ignore-scripts', '--store-dir', path.join(workDir, 'empty-store')], cwd: workDir, env, timeoutMs: recipe.installTimeoutMs ?? 180000, logFile: path.join(workDir, 'install.log') })
    verification.timings.install = installed.seconds
    verification.checks.install = installed.exitCode === 0
    if (!verification.checks.install) throw new Error(`Cold install ${installed.timedOut ? 'timed out' : 'failed'}: ${installed.output.slice(-1000)}`)
    const compose = await isolation.run({ mode: 'offline', argv: [process.execPath, host.dshBin, '--profile', 'web', '--dump-config'], cwd: workDir, env, logFile: path.join(workDir, 'compose.log') })
    verification.timings.compose = compose.seconds
    verification.checks.compose = compose.exitCode === 0 && !/failed to import/i.test(compose.output)
    if (!verification.checks.compose) throw new Error('Configuration composition failed')
    if(recipe.probes.registrations?.length){verification.registrationEvidence=registrationEvidenceOf(compose.output,recipe.probes.registrations);verification.checks.registration=true}
    const hostPrefix = isolation.platform === 'darwin' ? await isolation.command({ mode: 'loopback', argv: [], cwd: workDir, env }) : []
    const probeInput = path.join(workDir, 'host-input.json'); await atomicJson(probeInput, { hostPrefix, dshBin: host.dshBin, npmName: recipe.npmName, probes: recipe.probes, logFile: path.join(workDir, 'host.log') })
    const boot = await (hostPrefix.length ? runCommand : options => isolation.run({ mode: 'loopback', ...options }))({ argv: [process.execPath, path.join(directory, 'host-probe.mjs'), probeInput], cwd: workDir, env, timeoutMs: 90000, logFile: path.join(workDir, 'host-result.log') })
    verification.timings.host = boot.seconds
    let result; try { result = JSON.parse(boot.output.trim()) } catch { throw new Error(`Invalid host result: ${boot.output.slice(-1000)}`) }
    const native = await isolation.run({ mode: 'offline', argv: [process.execPath, path.join(directory, 'native-probe.mjs'), probeInput], cwd: workDir, env, logFile: path.join(workDir, 'native.log') })
    Object.assign(verification.checks, { host: boot.exitCode === 0 && result.host, clientModule: result.clientModule, native: native.exitCode === 0 })
    verification.status = 'passed'; assertVerification(verification, task, artifact.sha256,recipe)
  } catch (error) { if (verification.status === 'passed') verification.status = 'failed'; verification.error = { message: error.message } }
  finally { await control?.close(); if(profileHome)await rm(profileHome,{recursive:true,force:true}); await atomicJson(path.join(workDir, 'verification.json'), verification) }
  return verification
}
