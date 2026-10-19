import test from 'node:test'
import assert from 'node:assert/strict'
import {PACKAGER_VERSION,buildKey}from'../lib/model.mjs'
test('new package metadata invalidates old cached build identities',()=>{assert.notEqual(PACKAGER_VERSION,'3');const input={recipe:{id:'x'},source:{repository:'a/b',commit:'a'.repeat(40)},target:'macos-arm64',host:{version:'0.2.0-rc.2'}};assert.notEqual(buildKey(input),buildKey({...input,packagerVersion:'3'}))})
