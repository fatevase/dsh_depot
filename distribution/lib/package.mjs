import { mkdir, writeFile, copyFile, cp } from 'node:fs/promises'
import path from 'node:path'
import semver from 'semver'
import { extractArchive } from './build.mjs'
import { atomicJson, readJson, fileDigest, within } from './model.mjs'
import { isolatedEnv, runCommand } from './process.mjs'
import { writePackageMetadata } from '@dsh-depot/offline-format/package-metadata'

export async function packageRuntime({ task, recipe, builtPackage, sourceDir, workDir, tools }) {
  const started = performance.now(), staging = path.join(workDir, 'package'), output = path.join(workDir, 'artifacts')
  await mkdir(output, { recursive: true }); await extractArchive(builtPackage, staging)
  const manifest = await readJson(path.join(staging, 'package.json')), local = recipe.packageRules?.localPackages ?? []
  const original = structuredClone(manifest)
  const descriptor = recipe.locks?.runtime
  if (!descriptor?.file || descriptor.origin !== 'adapter') throw new Error('A frozen runtime adapter lock is required')
  const lockFile = within(recipe._root, descriptor.file)
  if (await fileDigest(lockFile) !== descriptor.digest) throw new Error('Runtime dependency lock changed')
  const lock = await readJson(lockFile), pinned = lock.packages?.['']?.dependencies ?? {}, optional = lock.packages?.['']?.optionalDependencies ?? {}
  const external = { ...manifest.dependencies, ...manifest.optionalDependencies }
  for (const item of local) delete external[item.name]
  if (Object.keys(external).sort().join() !== Object.keys({ ...pinned, ...optional }).sort().join()) throw new Error('Runtime lock does not cover this source; needs_recipe')
  for (const [name, range] of Object.entries(external)) if (!semver.valid(pinned[name] ?? optional[name]) || !semver.satisfies(pinned[name] ?? optional[name], range, { includePrerelease: true })) throw new Error(`Runtime lock incompatible with ${name}; needs_recipe`)
  manifest.dependencies = { ...pinned }; manifest.optionalDependencies = { ...optional }
  delete manifest.devDependencies; delete manifest.bundledDependencies
  manifest.scripts = {}; manifest.bundleDependencies = []
  lock.name = manifest.name; lock.version = manifest.version; lock.packages[''].name = manifest.name; lock.packages[''].version = manifest.version
  delete lock.packages[''].devDependencies; delete lock.packages[''].peerDependencies
  await atomicJson(path.join(staging, 'package.json'), manifest); await atomicJson(path.join(staging, 'package-lock.json'), lock)
  const env = await isolatedEnv(path.join(workDir, 'environment'), { bin: tools.bin, cache: tools.cache ?? path.join(workDir, 'cache/npm') })
  if (Object.keys(external).length) {
    const installed = await runCommand({ argv: [...tools.npm, 'ci', '--omit=dev', '--ignore-scripts', '--legacy-peer-deps', '--no-audit', '--no-fund'], cwd: staging, env, logFile: path.join(workDir, 'runtime-install.log') })
    if (installed.exitCode) throw new Error(`Frozen runtime installation failed: ${installed.output.slice(-1500)}`)
  }
  for (const item of local) {
    const localRoot = within(sourceDir, item.path), info = await readJson(path.join(localRoot, 'package.json'))
    if (info.name !== item.name || !semver.satisfies(info.version, original.dependencies?.[item.name] ?? '', { includePrerelease: true })) throw new Error('Same-source client identity mismatch')
    if (Object.keys(info.dependencies ?? {}).length || Object.keys(info.optionalDependencies ?? {}).length) throw new Error('Local client has runtime dependencies; recipe must provide their closure')
    const packed = await runCommand({ argv: [...tools.npm, 'pack', '--ignore-scripts', '--json', '--pack-destination', output], cwd: localRoot, env, logFile: path.join(workDir, `local-${item.name.replaceAll('/', '-')}.log`) })
    if (packed.exitCode) throw new Error(`Cannot pack same-source client: ${packed.output.slice(-2000)}`)
    const archive = path.join(output, JSON.parse(packed.stdout)[0].filename), dest = within(path.join(staging, 'node_modules'), item.name)
    await extractArchive(archive, dest)
    manifest.dependencies[item.name] = info.version
  }
  manifest.bundleDependencies = [...Object.keys(manifest.dependencies), ...Object.keys(manifest.optionalDependencies)].sort()
  if (!Object.keys(manifest.optionalDependencies).length) delete manifest.optionalDependencies
  await atomicJson(path.join(staging, 'package.json'), manifest)
  await writePackageMetadata(staging, {task,recipe})
  const packed = await runCommand({ argv: [...tools.npm, 'pack', '--ignore-scripts', '--json', '--pack-destination', output], cwd: staging, env, logFile: path.join(workDir, 'offline-pack.log') })
  if (packed.exitCode) throw new Error(`Offline pack failed: ${packed.output.slice(-1500)}`)
  const metadata = JSON.parse(packed.stdout)[0], originalArchive = path.join(output, metadata.filename)
  const artifact = path.join(output, `${recipe.id}-${task.source.version}-${task.target}-${task.buildKey}.tgz`)
  await copyFile(originalArchive, artifact)
  const sha256 = await fileDigest(artifact)
  const receipt = { schemaVersion: 1, buildKey: task.buildKey, recipeId: recipe.id, source: task.source, target: task.target, host: task.host, stage: 'build', status: 'built', artifacts: { package: artifact, sha256, compressedBytes: metadata.size, unpackedBytes: metadata.unpackedSize, manifest }, timings: { packaging: +(performance.now() - started).toFixed(3) / 1000 } }
  await atomicJson(path.join(output, 'dependencies.json'), { schemaVersion: 1, dependencies: manifest.dependencies, optionalDependencies: manifest.optionalDependencies ?? {}, hostPeers: manifest.peerDependencies ?? {}, bundled: manifest.bundleDependencies })
  await atomicJson(path.join(output, 'provenance.json'), { ...receipt, tools: tools.versions ?? { node: process.versions.node }, originalManifest: original, runtimeLockSha256: descriptor.digest })
  await writeFile(path.join(output, 'SHA256SUMS'), `${sha256}  ${path.basename(artifact)}\n`)
  receipt.artifacts.provenance = path.join(output, 'provenance.json'); receipt.artifacts.dependencies = path.join(output, 'dependencies.json'); receipt.artifacts.checksums = path.join(output, 'SHA256SUMS')
  return receipt
}
