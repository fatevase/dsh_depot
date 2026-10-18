import semver from 'semver'
import { digest, jsonDigest, safeRelative } from './model.mjs'
function repositoryIdentity(repository) { const value = typeof repository === 'object' ? repository.url : repository; return value?.replace(/^git\+/, '').replace(/^git@github.com:/, 'https://github.com/').replace(/\.git$/, '').replace(/^https?:\/\/github.com\//, '').replace(/^github:/, '').toLowerCase() }
export async function discover({ recipes, previous = {}, github, candidateFeeds = [] }) {
  const sources = [], candidates = [...(previous.candidates ?? [])], errors = []
  for (const recipe of recipes.filter(r => r.enabled)) {
    try {
      let refs
      if (recipe.channel.type === 'branch') refs = [{ name: recipe.channel.ref }]
      else if (recipe.channel.type === 'fixed') refs = [{ name: recipe.channel.ref ?? recipe.seed?.commit, commit: { sha: recipe.channel.ref ?? recipe.seed?.commit } }]
      else refs = (await github.list(`/repos/${recipe.repository}/${recipe.channel.type === 'releases' ? 'releases' : 'tags'}`)).filter(r => !r.draft).map(r => ({ name: r.tag_name ?? r.name, commit: r.commit })).filter(r => { const v = semver.valid(r.name); return v && semver.satisfies(v, recipe.allowedVersions, { includePrerelease: recipe.channel.allowPrerelease }) }).slice(0, 20)
      if (recipe.seed && !refs.some(r => r.commit?.sha === recipe.seed.commit || r.name === recipe.seed.ref)) refs.push({ name: recipe.seed.ref, commit: { sha: recipe.seed.commit } })
      for (const ref of refs) {
        const { data: resolved } = await github.request(`/repos/${recipe.repository}/commits/${encodeURIComponent(ref.commit?.sha ?? ref.name)}`)
        const commit = resolved.sha
        if (!/^[a-f0-9]{40}$/i.test(commit ?? '')) throw new Error('Source did not resolve to a commit')
        const old = previous.refHistory?.[`${recipe.repository.toLowerCase()}|${ref.name}`] ?? (previous.sources ?? []).find(s => s.repository === recipe.repository && s.ref === ref.name)
        if (recipe.channel.type !== 'branch' && old && old.commit !== commit) { sources.push({ ...old, error: { code: 'source_conflict', message: 'Previously observed ref moved to another commit' } }); continue }
        const prefix = recipe.packagePath === '.' ? '' : `${safeRelative(recipe.packagePath)}/`
        const manifest = JSON.parse(await github.text(recipe.repository, prefix + 'package.json', commit))
        if (manifest.name !== recipe.npmName || (manifest.repository && repositoryIdentity(manifest.repository) !== recipe.repository.toLowerCase())) throw new Error('Package/repository identity mismatch')
        if (!semver.valid(manifest.version)) throw new Error('Invalid package version')
        const tagVersion = semver.valid(ref.name)
        if (tagVersion && tagVersion !== manifest.version) throw new Error('Tag and package version disagree')
        const lockDigests = {}
        for (const lock of Object.values(recipe.locks ?? {})) if (lock.file && lock.origin !== 'adapter') lockDigests[lock.file] = digest(await github.text(recipe.repository, prefix + safeRelative(lock.file), commit))
        sources.push({ ...(commit === recipe.seed?.commit ? {archiveSha256:recipe.seed.archiveSha256} : {}), recipeId: recipe.id, repository: recipe.repository, ref: ref.name, commit, version: manifest.version, manifestDigest: jsonDigest(manifest), lockDigests, peerDependencies: manifest.peerDependencies ?? {}, peerDependenciesMeta: manifest.peerDependenciesMeta ?? {}, observedAt: new Date().toISOString() })
      }
    } catch (error) {
      errors.push({ recipeId: recipe.id, message: error.message })
      for (const old of previous.sources ?? []) if (old.recipeId === recipe.id && !sources.some(s => s.recipeId === old.recipeId && s.ref === old.ref)) sources.push({ ...old, stale: true })
    }
  }
  for (const feed of candidateFeeds) try {
    const found = feed.type === 'github-topic' ? await github.list(`/search/repositories?q=${encodeURIComponent(feed.query ?? 'topic:dsh-plugin')}`) : await fetch(feed.url, { signal: AbortSignal.timeout(20000) }).then(async r => { if (!r.ok) throw new Error(`Index HTTP ${r.status}`); const j = await r.json(); return Array.isArray(j) ? j : j.items ?? [] })
    for (const item of found) {
      const repository = item.full_name ?? item.repository
      if (/^[\w.-]+\/[\w.-]+$/.test(repository ?? '') && !recipes.some(r => r.repository.toLowerCase() === repository.toLowerCase()) && !candidates.some(c => c.repository.toLowerCase() === repository.toLowerCase())) candidates.push({ repository, status: 'needs_recipe', discoveredAt: new Date().toISOString(), source: feed.type })
    }
  } catch (error) { errors.push({ feed: feed.type, message: error.message }) }
  return { schemaVersion: 1, sources, candidates, errors, complete: errors.length === 0, apiCache: github.cache, checkedAt: new Date().toISOString() }
}
