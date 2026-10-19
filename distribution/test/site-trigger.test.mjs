import test from 'node:test'
import assert from 'node:assert/strict'
test('published catalogs refresh after successful publication even if a platform matrix failed',async()=>{
 const {shouldRefreshWebsite}=await import('../lib/site-trigger.mjs')
 const run={head_branch:'main',event:'schedule',head_repository:{full_name:'fatevase/dsh_depot'},conclusion:'failure'}
 const jobs=[{name:'build (win32-x64)',conclusion:'failure'},{name:'publish',conclusion:'success'}]
 assert.equal(shouldRefreshWebsite({run,jobs,repository:'fatevase/dsh_depot',defaultBranch:'main'}),true)
 for(const bad of [{...run,event:'pull_request'},{...run,head_branch:'feature'},{...run,head_repository:{full_name:'other/fork'}}])assert.equal(shouldRefreshWebsite({run:bad,jobs,repository:'fatevase/dsh_depot',defaultBranch:'main'}),false)
 for(const conclusion of ['failure','skipped','cancelled',null])assert.equal(shouldRefreshWebsite({run,jobs:[{name:'publish',conclusion}],repository:'fatevase/dsh_depot',defaultBranch:'main'}),false)
 assert.equal(shouldRefreshWebsite({run,jobs:[],repository:'fatevase/dsh_depot',defaultBranch:'main'}),false)
})
