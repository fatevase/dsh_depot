import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile, rename, readdir } from 'node:fs/promises'
import path from 'node:path'

export const SCHEMA = 1
export const PACKAGER_VERSION = '1'
export const VERIFIER_VERSION = '1'
export const digest = value => createHash('sha256').update(value).digest('hex')
export const fileDigest = async file => digest(await readFile(file))
export function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().filter(k => !k.startsWith('_') && value[k] !== undefined).map(k => [k, canonical(value[k])]))
  return value
}
export const jsonDigest = value => digest(JSON.stringify(canonical(value)) ?? 'undefined')
export const readJson = async (file, fallback) => { try { return JSON.parse(await readFile(file, 'utf8')) } catch (error) { if (error.code === 'ENOENT' && fallback !== undefined) return structuredClone(fallback); throw error } }
export async function atomicJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true })
  const temporary = `${file}.${randomUUID()}.tmp`
  await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 })
  await rename(temporary, file)
}
export function safeRelative(value) {
  if (typeof value !== 'string' || !value || value.includes('\\') || value.includes('\0') || value.startsWith('/') || /^[A-Za-z]:/.test(value) || value.split('/').includes('..')) throw new Error(`Unsafe relative path: ${value}`)
  return value
}
export function within(root, relative) { safeRelative(relative); const resolved = path.resolve(root, relative); if (resolved !== path.resolve(root) && !resolved.startsWith(path.resolve(root) + path.sep)) throw new Error('Path escapes root'); return resolved }
export function assertRecipe(r) {
  if (r.schemaVersion !== SCHEMA || !/^[a-z0-9][a-z0-9-]*$/.test(r.id ?? '')) throw new Error('Invalid recipe identity/schema')
  if (!/^[\w.-]+\/[\w.-]+$/.test(r.repository ?? '')) throw new Error('Invalid repository')
  if (!/^(@[\w.-]+\/)?[\w.-]+$/.test(r.npmName ?? '')) throw new Error('Invalid npm name')
  safeRelative(r.packagePath)
  if (!['tags', 'releases', 'branch', 'fixed'].includes(r.channel?.type)) throw new Error('Invalid update channel')
  if (!Array.isArray(r.targets) || !r.targets.length || r.targets.some(t => !['darwin-arm64', 'linux-x64', 'win32-x64'].includes(t))) throw new Error('Invalid target')
  if (!Array.isArray(r.buildCommands) || r.buildCommands.some(a => !Array.isArray(a) || !a.length || a.some(v => typeof v !== 'string' || v.includes('\0')))) throw new Error('Commands must be argv arrays')
  if (!r.toolchain?.node || !r.hostRange || !r.allowedVersions || !r.probes) throw new Error('Missing recipe policy')
  for (const lock of Object.values(r.locks ?? {})) if (lock?.file) safeRelative(lock.file)
  for (const local of r.packageRules?.localPackages ?? []) safeRelative(local.path)
  return r
}
export async function readRecipes(dir) {
  const recipes = []
  for (const file of (await readdir(dir)).filter(f => f.endsWith('.json')).sort()) {
    const r = assertRecipe(await readJson(path.join(dir, file)))
    r._root = path.dirname(dir)
    for (const lock of Object.values(r.locks ?? {})) if (lock?.origin === 'adapter') {
      try { lock.digest = await fileDigest(within(r._root, lock.file)) } catch (error) { r._lockError = error.message }
    }
    recipes.push(r)
  }
  return recipes
}
export function buildKey({ recipe, source, target, host, packagerVersion = PACKAGER_VERSION, verifierVersion = VERIFIER_VERSION }) {
  const { repository, commit, version, manifestDigest, lockDigests, peerDependencies, archiveSha256 } = source
  return jsonDigest({ recipe, source: { repository, commit, version, manifestDigest, lockDigests, peerDependencies, archiveSha256 }, target, host, packagerVersion, verifierVersion })
}
export const initialState = () => ({ schemaVersion: SCHEMA, sources: [], candidates: [], receipts: {}, published: {}, withdrawn: {}, latest: {}, refHistory: {}, lastSuccessfulDiscoveryAt: null })
