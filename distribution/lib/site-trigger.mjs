// A failed platform build can still publish labelled unverified packages.
// Refresh from publication success, never from untrusted upstream artifacts.
export function shouldRefreshWebsite({run,jobs,repository,defaultBranch}) {
 return run?.head_repository?.full_name===repository && run.head_branch===defaultBranch &&
  ['push','schedule','workflow_dispatch'].includes(run.event) &&
  jobs.some(job=>job.name==='publish' && job.conclusion==='success')
}
