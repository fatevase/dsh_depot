import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, readFile, writeFile, rename, readdir } from 'node:fs/promises'
import path from 'node:path'
import { supportedTarget } from './platform.mjs'

export const SCHEMA = 1
export const PACKAGER_VERSION = '5'
export const VERIFIER_VERSION = '3'
export const PLATFORM_VERIFIER_VERSIONS = { 'win32-x64': '3.windows-wfp-3' }
export const digest = value => createHash('sha256').update(value).digest('hex')
export const fileDigest = async file => { const hash=createHash('sha256'); for await(const chunk of createReadStream(file))hash.update(chunk); return hash.digest('hex') }
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
  if(r.sourceArchiveExcludes){if(!Array.isArray(r.sourceArchiveExcludes))throw Error('Invalid source exclusions');for(const entry of r.sourceArchiveExcludes)safeRelative(entry)}
  if (!['tags', 'releases', 'branch', 'fixed'].includes(r.channel?.type)) throw new Error('Invalid update channel')
  if (!Array.isArray(r.targets) || !r.targets.length || r.targets.some(t => !supportedTarget(t))) throw new Error('Invalid target')
  if (!Array.isArray(r.buildCommands) || r.buildCommands.some(a => !Array.isArray(a) || !a.length || a.some(v => typeof v !== 'string' || v.includes('\0')))) throw new Error('Commands must be argv arrays')
  if (!r.toolchain?.node || !r.hostRange || !r.allowedVersions || !r.probes) throw new Error('Missing recipe policy')
  for (const lock of Object.values(r.locks ?? {})) if (lock?.file) safeRelative(lock.file)
  for (const local of r.packageRules?.localPackages ?? []) safeRelative(local.path)
  return r
}
export async function readRecipes(dir, { cohort } = {}) {
  const recipes = []
  for (const file of (await readdir(dir)).filter(f => f.endsWith('.json')).sort()) {
    const r = assertRecipe(await readJson(path.join(dir, file)))
    r._root = path.dirname(dir)
    for (const lock of Object.values(r.locks ?? {})) if (lock?.origin === 'adapter') {
      try { lock.digest = await fileDigest(within(r._root, lock.file)) } catch (error) { r._lockError = error.message }
    }
    recipes.push(r)
  }
  if (!cohort) return recipes
  if (!Array.isArray(cohort) || !cohort.length || new Set(cohort.map(p=>p.recipeId)).size!==cohort.length) throw Error('Invalid or duplicate cohort entries')
  return cohort.map(entry=>{
    const recipe=recipes.find(r=>r.id===entry.recipeId)
    if(!recipe)throw Error(`Missing cohort recipe: ${entry.recipeId}`)
    if(recipe.repository.toLowerCase()!==entry.repository.toLowerCase())throw Error(`Cohort repository mismatch: ${entry.recipeId}`)
    return recipe
  })
}
export function buildKey({ recipe, source, target, host, packagerVersion = PACKAGER_VERSION, verifierVersion = PLATFORM_VERIFIER_VERSIONS[target] ?? VERIFIER_VERSION }) {
  const { repository, commit, version, manifestDigest, lockDigests, peerDependencies, archiveSha256 } = source
  return jsonDigest({ recipe, source: { repository, commit, version, manifestDigest, lockDigests, peerDependencies, archiveSha256 }, target, host, packagerVersion, verifierVersion })
}
export const initialState = () => ({ schemaVersion: SCHEMA, sources: [], candidates: [], receipts: {}, published: {}, withdrawn: {}, latest: {}, refHistory: {}, lastSuccessfulDiscoveryAt: null })
