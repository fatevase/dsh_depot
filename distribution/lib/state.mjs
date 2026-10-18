import semver from 'semver'
import { initialState, jsonDigest } from './model.mjs'
export const pointerKey = p => `${p.recipeId}|${p.host.version}|${p.host.node}|${p.target}`
export function mergeState(previous = initialState(), { discovery, receipts = [], publications = [] } = {}) {
  const state = structuredClone(previous)
  state.refHistory ??= {}
  for(const s of [...(previous.sources??[]),...(discovery?.sources??[])])if(s.repository&&s.ref&&!s.error){const key=`${s.repository.toLowerCase()}|${s.ref}`;state.refHistory[key]??=structuredClone(s)}
  if (discovery) {
    const candidates = new Map(state.candidates.map(c=>[c.repository.toLowerCase(),c]))
    for(const c of discovery.candidates??[])if(!candidates.has(c.repository.toLowerCase()))candidates.set(c.repository.toLowerCase(),c)
    state.candidates=[...candidates.values()]
    if((discovery.checkedAt??'') >= (state.lastDiscoveryAt??'')) { state.sources=discovery.sources; state.discoveryErrors=discovery.errors??[]; state.lastDiscoveryAt=discovery.checkedAt; state.apiCache=discovery.apiCache??state.apiCache }
    if(discovery.complete && (discovery.checkedAt??'') >= (state.lastSuccessfulDiscoveryAt??'')) state.lastSuccessfulDiscoveryAt=discovery.checkedAt
  }
  for (const receipt of receipts) {
    const old = state.receipts[receipt.buildKey]
    if (!old || (receipt.attempt ?? '') >= (old.attempt ?? '')) state.receipts[receipt.buildKey] = receipt
  }
  for (const p of publications) {
    if (state.withdrawn[p.buildKey] || p.status !== 'published') continue
    const old = state.published[p.buildKey]
    if (old && old.sha256 !== p.sha256) throw new Error('Immutable publication checksum conflict')
    state.published[p.buildKey] = p
    const pointer = pointerKey(p), latest = state.published[state.latest[pointer]]
    if (!latest || semver.gt(p.version, latest.version) || (p.version === latest.version && (p.source?.commit !== latest.source?.commit ? !!p.source?.observedAt && !!latest.source?.observedAt && p.source.observedAt > latest.source.observedAt : !!p.plannedAt && !!latest.plannedAt && p.plannedAt > latest.plannedAt))) state.latest[pointer] = p.buildKey
  }
  return state
}
export function withdraw(previous, key, reason) {
  if (!reason || !previous.published[key]) throw new Error('Withdrawal requires a published key and reason')
  const state = structuredClone(previous); state.withdrawn[key] = { reason, at: new Date().toISOString() }
  for (const [pointer, value] of Object.entries(state.latest)) if (value === key) {
    delete state.latest[pointer]
    const candidates = Object.values(state.published).filter(p => pointerKey(p) === pointer && !state.withdrawn[p.buildKey]).sort((a,b) => semver.rcompare(a.version,b.version))
    if (candidates[0]) state.latest[pointer] = candidates[0].buildKey
  }
  return state
}
export function rollback(previous, { key, recipeId, host, target }) {
  const p = previous.published[key]
  if (!p || p.status !== 'published' || p.verification?.status !== 'passed' || previous.withdrawn[key] || pointerKey(p) !== pointerKey({ recipeId, host, target })) throw new Error('Rollback needs a verified published package for the identical host and target')
  const state = structuredClone(previous); state.latest[pointerKey(p)] = key; return state
}
export async function updateStateBranch({ store, merge, retries = 2 }) {
  for (let attempt = 0; ; attempt++) {
    const current = await store.read(), next = await merge(current.state)
    if (jsonDigest(next) === jsonDigest(current.state)) return { ...current, changed: false }
    try { const result = await store.write(current.commit, next); return { ...result, state: next, changed: true } }
    catch (error) { if (![409, 422].includes(error.status) || attempt >= retries) throw error }
  }
}
export function githubStateStore({ repository, branch = 'distribution-state', github }) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new Error('Explicit repository required')
  const base = `/repos/${repository}`, ref = `/git/refs/heads/${encodeURIComponent(branch)}`
  return {
    async read() {
      let commit
      try { commit = (await github.request(base + ref)).data.object.sha } catch (error) { if (error.status === 404) return { commit: null, state: initialState() }; throw error }
      const state = JSON.parse(await github.text(repository, 'state.json', commit))
      return { commit, state }
    },
    async write(expected, state) {
      const blob = (await github.request(base + '/git/blobs', { method: 'POST', body: { content: JSON.stringify(state, null, 2) + '\n', encoding: 'utf-8' } })).data
      const tree = (await github.request(base + '/git/trees', { method: 'POST', body: { tree: [{ path: 'state.json', mode: '100644', type: 'blob', sha: blob.sha }] } })).data
      const commit = (await github.request(base + '/git/commits', { method: 'POST', body: { message: 'Update plugin distribution state', tree: tree.sha, parents: expected ? [expected] : [] } })).data
      if (expected) await github.request(base + ref, { method: 'PATCH', body: { sha: commit.sha, force: false } })
      else await github.request(base + '/git/refs', { method: 'POST', body: { ref: `refs/heads/${branch}`, sha: commit.sha } })
      return { commit: commit.sha }
    }
  }
}
