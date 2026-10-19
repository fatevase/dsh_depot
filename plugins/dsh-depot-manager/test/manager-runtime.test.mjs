import test from 'node:test'
import assert from 'node:assert/strict'
import {resolveRuntime} from '../bootstrap/runtime.mjs'
test('full runtime refuses a changed binary before evaluating it',async()=>{await assert.rejects(()=>resolveRuntime({bundle:{flavor:'full',root:process.cwd(),runtimeDigest:'0'.repeat(64)},nodePath:process.execPath}),{code:'RUNTIME_HASH_MISMATCH'})})
