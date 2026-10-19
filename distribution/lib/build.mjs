import { runtimeTarget } from './platform.mjs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdir, copyFile, writeFile, readFile, rm } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { randomUUID } from 'node:crypto'
import { atomicJson, readJson, fileDigest, jsonDigest, within, buildKey, safeRelative } from './model.mjs'
import { hostEnvironmentDigest } from './host-environment.mjs'
import { isolatedEnv, runCommand, commandArgv, prepareTools } from './process.mjs'
const execute = promisify(execFile)
export async function extractArchive(archive, directory, { strip = 1, exclude = [], links = 'reject', python = process.platform === 'win32' ? 'python' : 'python3' } = {}) {
  try { await execute(python, [fileURLToPath(new URL('./archive.py', import.meta.url)), archive, directory, '--strip', String(strip), '--links', links, ...exclude.flatMap(p=>['--exclude',safeRelative(p)])], { maxBuffer: 1024 * 1024 }) } catch (error) { throw new Error(`Unsafe or invalid archive: ${error.stderr || error.message}`) }
  return directory
}
export async function downloadArchive(url, output, { maxBytes = 536870912, sha256 } = {}) {
  if (!url.startsWith('https://')) throw new Error('Source archive requires HTTPS')
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 2147483648) throw new Error('Invalid download size limit')
  const response = await fetch(url, { signal: AbortSignal.timeout(120000) })
  if (!response.ok) throw new Error(`Archive download HTTP ${response.status}`)
  if (+response.headers.get('content-length') > maxBytes) { await response.body?.cancel(); throw new Error(`Archive download too large (limit ${maxBytes} bytes)`) }
  let total = 0, created = false
  try {
    const destination = createWriteStream(output, {flags:'wx'})
    destination.once('open', () => { created = true })
    await pipeline(response.body, new Transform({ transform(chunk, encoding, callback) { total += chunk.length; callback(total > maxBytes ? new Error(`Archive download too large (limit ${maxBytes} bytes)`) : null, chunk) } }), destination)
    if (sha256 && (!/^[a-f0-9]{64}$/.test(sha256) || await fileDigest(output) !== sha256)) throw new Error('Downloaded artifact checksum mismatch')
    return output
  } catch (error) { if (created) await rm(output, {force:true}); throw error }
}
export async function buildTask(task, { recipe, workDir, tools, sourceArchive } = {}) {
  const receiptDir = path.resolve(workDir)
  workDir = path.join(receiptDir, `attempt-${randomUUID()}`)
  const receipt = { schemaVersion: 1, buildKey: task.buildKey, recipeId: task.recipeId, recipeDigest: task.recipeDigest, plannedAt: task.plannedAt, source: task.source, target: task.target, host: task.host, stage: 'build', status: 'failed', artifacts: {}, timings: {}, attempt: new Date().toISOString() }
  await mkdir(workDir, { recursive: true })
  try {
    if (task.target !== runtimeTarget(process.platform,process.arch)) throw new Error('Target does not match runner')
    if (task.recipeDigest !== jsonDigest(recipe) || task.buildKey !== buildKey({ recipe, source: task.source, target: task.target, host: task.host })) throw new Error('Build plan inputs changed')
    if(task.host.environmentDigest !== hostEnvironmentDigest())throw new Error('Host dependency graph differs from plan')
    if(sourceArchive && !task.source.archiveSha256)throw new Error('Local source archive requires a pinned checksum in the plan')
    tools ??= await prepareTools(recipe.toolchain, path.resolve(workDir, '../../../tools', `${recipe.toolchain.node}-${recipe.toolchain.pnpm}`))
    const archive = path.join(workDir, 'source.tgz'), started = performance.now()
    if (sourceArchive) await copyFile(sourceArchive, archive)
    else await downloadArchive(`https://codeload.github.com/${task.source.repository}/tar.gz/${task.source.commit}`, archive)
    receipt.timings.source = (performance.now() - started) / 1000
    receipt.sourceArchiveSha256 = await fileDigest(archive)
    if (task.source.archiveSha256 && task.source.archiveSha256 !== receipt.sourceArchiveSha256) throw new Error('Source archive checksum mismatch')
    const sourceRoot = await extractArchive(archive, path.join(workDir, 'source'), {exclude:recipe.sourceArchiveExcludes??[]}), packageRoot = within(sourceRoot, recipe.packagePath)
    const manifest = await readJson(path.join(packageRoot, 'package.json'))
    if (manifest.name !== recipe.npmName || manifest.version !== task.source.version || jsonDigest(manifest) !== task.source.manifestDigest) throw new Error('Source manifest does not match frozen plan')
    const env = await isolatedEnv(path.join(workDir, 'build-environment'), { bin: tools.bin, cache: tools.cache ?? path.join(workDir, 'build-cache/npm') })
    const installRoot = within(packageRoot, recipe.installPath ?? '.')
    const lock = recipe.locks?.build
    if (lock?.origin === 'adapter') {
      if (await fileDigest(within(recipe._root, lock.file)) !== lock.digest) throw new Error('Adapter lock changed')
      await copyFile(within(recipe._root, lock.file), path.join(installRoot, 'package-lock.json'))
    } else if (lock?.file && await fileDigest(within(packageRoot, lock.file)) !== task.source.lockDigests[lock.file]) throw new Error('Source dependency lock changed')
    if (recipe.install !== false) {
      const manager = recipe.packageManager ?? 'npm'
      const install = await runCommand({ argv: commandArgv(manager === 'pnpm' ? ['pnpm', 'install', '--frozen-lockfile', '--ignore-scripts', '--config.manage-package-manager-versions=false', '--config.minimumReleaseAge=0'] : ['npm', 'ci', '--ignore-scripts', '--no-audit', '--no-fund'], tools), cwd: installRoot, env, logFile: path.join(workDir, 'install.log') })
      receipt.timings.dependencies = install.seconds
      if (install.exitCode) throw new Error(`Dependency preparation failed: ${install.output.slice(-1500)}`)
    }
    for (let index = 0; index < recipe.buildCommands.length; index++) {
      const result = await runCommand({ argv: commandArgv(recipe.buildCommands[index], tools), cwd: packageRoot, env, timeoutMs: recipe.buildTimeoutMs ?? 600000, logFile: path.join(workDir, `build-${index}.log`) })
      receipt.timings.compile = (receipt.timings.compile ?? 0) + result.seconds
      if (result.exitCode) throw new Error(`Build command ${index} failed: ${result.output.slice(-1500)}`)
    }
    const authored = path.join(workDir, 'authored'); await mkdir(authored)
    const packed = await runCommand({ argv: [...tools.npm, 'pack', '--ignore-scripts', '--json', '--pack-destination', authored], cwd: packageRoot, env, logFile: path.join(workDir, 'authored-pack.log') })
    if (packed.exitCode) throw new Error(`Authored pack failed: ${packed.output.slice(-1000)}`)
    const filename = JSON.parse(packed.stdout)[0].filename
    const { packageRuntime } = await import('./package.mjs')
    const packaged = await packageRuntime({ task, recipe, builtPackage: path.join(authored, filename), sourceDir: packageRoot, workDir: path.join(workDir, 'runtime'), tools })
    Object.assign(receipt, packaged, { timings: { ...receipt.timings, ...packaged.timings }, sourceArchiveSha256: receipt.sourceArchiveSha256 })
  } catch (error) { receipt.error = { message: error.message }; receipt.status = 'failed' }
  await atomicJson(path.join(receiptDir, 'build-receipt.json'), receipt)
  return receipt
}
