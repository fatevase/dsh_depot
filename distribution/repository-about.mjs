// Pages descriptions come from GitHub's repository About field, including an empty About.
const repositoryPattern = /^[\w.-]+\/[\w.-]+$/
const sameId = (a, b) => a != null && b != null && String(a) === String(b)

export async function refreshRepositoryAbout({github, repositories, previous = {}}) {
  const entries = new Map()
  for (const value of repositories) {
    const entry = typeof value === 'string' ? {repository: value} : value
    if (!repositoryPattern.test(entry?.repository ?? '')) throw Error('Invalid repository About source')
    if (entry.repositoryId != null && !/^[1-9]\d*$/.test(String(entry.repositoryId))) throw Error('Invalid repository About ID')
    const key = entry.repository.toLowerCase(), existing = entries.get(key)
    if (existing?.repositoryId != null && entry.repositoryId != null && !sameId(existing.repositoryId, entry.repositoryId)) throw Error(`Conflicting repository About IDs: ${entry.repository}`)
    entries.set(key, {...existing, ...entry, repositoryId: entry.repositoryId ?? existing?.repositoryId})
  }

  const about = {}, queue = [...entries], results = new Array(queue.length)
  let cursor = 0
  async function worker() {
    while (cursor < queue.length) {
      const index = cursor++, [key, entry] = queue[index]
      let requestCompleted = false
      try {
        const {data} = await github.request(`/repos/${entry.repository}`)
        requestCompleted = true
        if (!data || !/^[1-9]\d*$/.test(String(data.id)) || (data.description != null && typeof data.description !== 'string')) throw Error('Invalid GitHub repository About response')
        if (entry.repositoryId != null && !sameId(entry.repositoryId, data.id)) throw Error(`Repository ID mismatch: expected ${entry.repositoryId}, received ${data.id}`)
        results[index] = {repository: entry.repository, repositoryId: data.id, description: data.description ?? '', observedAt: new Date().toISOString()}
      } catch (error) {
        const cached = previous[key]
        const status = Number(error?.status)
        const transient = !requestCompleted && (!status || status === 408 || status === 429 || status >= 500 || status === 403)
        const compatible = cached && (entry.repositoryId == null || sameId(entry.repositoryId, cached.repositoryId))
        const retained = transient && compatible && typeof cached.description === 'string'
        const message = error instanceof Error ? error.message : String(error)
        results[index] = {
          repository: entry.repository,
          repositoryId: entry.repositoryId ?? (retained ? cached.repositoryId : null),
          description: retained ? cached.description : '',
          observedAt: retained ? cached.observedAt : null,
          error: message,
        }
        console.warn(`Repository About refresh failed for ${entry.repository}: ${message}`)
      }
    }
  }
  await Promise.all(Array.from({length: Math.min(4, queue.length)}, () => worker()))
  for (let index = 0; index < queue.length; index++) about[queue[index][0]] = results[index]
  return about
}

export function applyRepositoryAbout(catalog, about = {}) {
  return {...catalog, plugins: catalog.plugins.map(plugin => {
    const entry = about[plugin.repository?.toLowerCase()]
    const compatible = entry && (plugin.repositoryId == null || sameId(plugin.repositoryId, entry.repositoryId))
    return {...plugin, description: compatible && typeof entry.description === 'string' ? entry.description : ''}
  })}
}
