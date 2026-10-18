// One destination owns state, Releases, and Pages. Overrides are assertions only.
export function distributionRepository(config, { requested, runningRepository, required = false } = {}) {
  const repository = config.distributionRepository
  if (repository != null && !/^[\w.-]+\/[\w.-]+$/.test(repository)) throw Error('Invalid distributionRepository in config')
  if (repository && requested && requested.toLowerCase() !== repository.toLowerCase()) throw Error(`Distribution repository mismatch: expected ${repository}`)
  if (required && !repository) throw Error('Set distributionRepository in distribution/config.json before remote operations')
  if (repository && runningRepository && runningRepository.toLowerCase() !== repository.toLowerCase()) throw Error(`Distribution workflow must run in ${repository}`)
  return repository
}
