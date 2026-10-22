import test from 'node:test'
import assert from 'node:assert/strict'
import {selectCandidateUpdates,candidateInputKey} from '../lib/candidate-updates.mjs'
const config={batchSize:2,targets:['linux-x64','macos-arm64'],entries:[1,2,3].map(repositoryId=>({repositoryId,repository:`owner/p${repositoryId}`,packagePath:'.',commit:'a'.repeat(40)}))}
test('scheduled candidates build changed inputs once and cap complete plugin groups',()=>{
 const first=selectCandidateUpdates(config,{scheduled:true,maxPlugins:2}),previous={}
 assert.deepEqual(first.entries.map(e=>e.repositoryId),[1,2]);assert.equal(first.matrix.include.length,2)
 for(const e of first.entries)for(const t of config.targets)previous[`${e.repositoryId}:${t}`]=candidateInputKey(e,t)
 const second=selectCandidateUpdates(config,{scheduled:true,previous,maxPlugins:2})
 assert.deepEqual(second.entries.map(e=>e.repositoryId),[3])
 const all={...previous};for(const t of config.targets)all[`3:${t}`]=candidateInputKey(config.entries[2],t)
 assert.equal(selectCandidateUpdates(config,{scheduled:true,previous:all}).matrix.include.length,0)
 const changed=structuredClone(config);changed.entries[0].commit='b'.repeat(40)
 assert.deepEqual(selectCandidateUpdates(changed,{scheduled:true,previous:all}).entries.map(e=>e.repositoryId),[1])
})
test('manual campaigns permit explicit retries and target selection; discovery errors do not erase prior inputs',()=>{
 const previous=Object.fromEntries(config.entries.flatMap(e=>config.targets.map(t=>[`${e.repositoryId}:${t}`,candidateInputKey(e,t)])))
 const manual=selectCandidateUpdates(config,{previous,target:'linux-x64'})
 assert.equal(manual.entries.length,3);assert.equal(manual.targets.length,1)
 const changed=structuredClone(config);changed.entries[0].error='API unavailable'
 const failed=selectCandidateUpdates(changed,{scheduled:true,previous})
 assert.equal(failed.entries[0].error,'API unavailable')
 assert.notEqual(candidateInputKey(changed.entries[0],'linux-x64'),previous['1:linux-x64'])
})
