import semver from 'semver'
import { buildKey, jsonDigest } from './model.mjs'
export function createPlan({ recipes, sources, state = {}, host, retryKeys = [] }) {
  const decisions = [], tasks = [], publications = [], publicationTasks = [], createdAt = new Date().toISOString()
  for(const recipe of recipes.filter(r=>!r.enabled&&r.blockedReason))for(const target of recipe.targets)decisions.push({recipeId:recipe.id,target,version:recipe.seed?.version,action:'needs_recipe',reason:recipe.blockedReason})
  for (const source of sources) if (!recipes.some(r => r.id === source.recipeId && r.enabled)) decisions.push({ recipeId: source.recipeId, action: 'needs_recipe', reason: 'Source has no enabled recipe' })
  for (const recipe of recipes.filter(r => r.enabled)) {
    let selected
    const available = sources.filter(s => s.recipeId === recipe.id).sort((a, b) => semver.valid(a.version) && semver.valid(b.version) ? semver.rcompare(a.version, b.version) : 0)
    if(!available.length)for(const target of recipe.targets)decisions.push({recipeId:recipe.id,target,action:'blocked',reason:'No usable source observation; inspect discovery errors'})
    for (const source of available) {
      const note = { recipeId: recipe.id, version: source.version }
      if (source.error || source.stale) { decisions.push({ ...note, action: 'blocked', reason: source.error?.code ?? 'source_fetch_failed' }); continue }
      const compatible = semver.valid(source.version) && semver.satisfies(source.version, recipe.allowedVersions, { includePrerelease: !!recipe.channel.allowPrerelease }) && semver.satisfies(host.version, recipe.hostRange, { includePrerelease: true }) && (!source.peerDependencies?.['@deepseek-ai/dsh'] || semver.satisfies(host.version, source.peerDependencies['@deepseek-ai/dsh'], { includePrerelease: true }))
      if (!compatible) { decisions.push({ ...note, action: 'incompatible', reason: 'Version or host constraints do not match' }); continue }
      const missingLock = recipe._lockError || Object.values(recipe.locks ?? {}).some(l => l.origin === 'adapter' ? !l.digest : l.file && !source.lockDigests?.[l.file])
      if (missingLock) { decisions.push({ ...note, action: 'blocked', reason: recipe._lockError ?? 'Missing frozen dependency lock' }); continue }
      selected = source; break
    }
    if (!selected) continue
    for (const target of recipe.targets) {
      const task = { schemaVersion: 1, plannedAt: createdAt, recipeId: recipe.id, source: selected, target, host, toolchain: recipe.toolchain, recipeDigest: jsonDigest(recipe) }
      task.buildKey = buildKey({ recipe, source: selected, target, host })
      const key = task.buildKey, receipt = state.receipts?.[key]
      let action = 'build', reason = 'New build inputs'
      if (state.withdrawn?.[key]) { action = 'withdrawn'; reason = 'Artifact explicitly withdrawn' }
      else if (state.published?.[key]?.status === 'published') { action = 'skip'; reason = 'Identical inputs already published' }
      else if (receipt?.status === 'verified' && state.availableArtifacts?.[key]?.sha256 === receipt.artifacts?.sha256 && receipt.artifacts?.sha256) { action = 'publish'; reason = 'Resume publication of verified bytes'; publications.push(key); task.plannedAt=receipt.plannedAt; publicationTasks.push(task) }
      else if (['failed', 'unverified', 'missing', 'needs_recipe'].includes(receipt?.status) && !retryKeys.includes(key) && !retryKeys.includes(recipe.id)) { action = 'needs_attention'; reason = 'Identical failed inputs require explicit retry' }
      decisions.push({ recipeId: recipe.id, version: selected.version, target, buildKey: key, action, reason })
      if (action === 'build') tasks.push(task)
    }
  }
  return { schemaVersion: 1, createdAt, decisions, tasks, publications, publicationTasks }
}
