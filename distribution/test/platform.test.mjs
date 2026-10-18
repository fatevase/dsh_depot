import test from 'node:test'
import assert from 'node:assert/strict'
import { runtimeTarget, supportedTarget } from '../lib/platform.mjs'
import { assertRecipe, initialState } from '../lib/model.mjs'
import { catalogOf, packageFileName } from '../lib/publish.mjs'
import { recipe } from './helpers.mjs'

test('macOS uses one target identity throughout configuration, runner matching and filenames',()=>{
 assert.equal(runtimeTarget('darwin','arm64'),'macos-arm64')
 assert.equal(runtimeTarget('linux','x64'),'linux-x64')
 assert.equal(supportedTarget('macos-arm64'),true)
 assert.equal(supportedTarget('darwin-arm64'),false)
 assert.throws(()=>assertRecipe(recipe({targets:['darwin-arm64']})),/Invalid target/)
 assert.equal(packageFileName({recipeId:'one',source:{version:'1.0.0'},target:'macos-arm64'}),'one-1.0.0-macos-arm64.tgz')
 assert.throws(()=>packageFileName({recipeId:'one',source:{version:'1.0.0'},target:'darwin-arm64'}),/Invalid/)
})
test('the current catalog excludes old target publications and pointers instead of aliasing them',()=>{
 const state=initialState()
 for(const [key,target] of [['old','darwin-arm64'],['new','macos-arm64']]){
  state.published[key]={buildKey:key,recipeId:'fixture',target,status:'published'}
  state.latest[target]=key
  state.receipts[key]={buildKey:key,recipeId:'fixture',target,status:'failed'}
 }
 const c=catalogOf(state,[recipe()])
 assert.deepEqual(c.packages.map(p=>p.buildKey),['new'])
 assert.deepEqual(c.latest,{'macos-arm64':'new'})
 assert.deepEqual(c.issues.map(p=>p.buildKey),['new'])
})
