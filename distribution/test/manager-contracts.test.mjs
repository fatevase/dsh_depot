import test from 'node:test'
import assert from 'node:assert/strict'
const api = await import('../manager/contracts/validate.mjs').catch(error => { if (error.code === 'ERR_MODULE_NOT_FOUND') return {}; throw error })
const host = () => ({ schemaVersion:1,hostId:'host-1',kind:'cli-web',version:'0.2.0-rc.2',profileName:'web',profileDir:'/tmp/profile',ownerId:'501',launch:{executable:'/usr/bin/node',args:[]},runtime:{source:'host',kind:'node',platform:'darwin',arch:'arm64',node:'26.9.0',abi:'148',napi:10},capabilities:{},fingerprint:'a'.repeat(64) })
test('plans reject executable commands and unsupported schema before accepting mutations',()=>{
 assert.equal(typeof api.validatePlan,'function','plan validator is implemented')
 assert.throws(()=>api.validatePlan({schemaVersion:1,action:'exec'}),{code:'INVALID_ACTION'})
 assert.throws(()=>api.validatePlan({schemaVersion:2,action:'install'}),{code:'UNSUPPORTED_SCHEMA'})
})
test('host validation accepts real target identities and rejects toolkit runtime substitution',()=>{
 assert.equal(typeof api.validateHost,'function','host validator is implemented')
 for(const [platform,arch,target] of [['darwin','arm64','macos-arm64'],['linux','x64','linux-x64'],['win32','x64','win32-x64']]){const h=host();Object.assign(h.runtime,{platform,arch});assert.equal(api.validateHost(h).target,target)}
 const h=host();h.runtime.source='toolkit';assert.throws(()=>api.validateHost(h),{code:'HOST_RUNTIME_REQUIRED'})
 h.runtime.source='host';h.runtime.arch='ia32';assert.throws(()=>api.validateHost(h),{code:'UNSUPPORTED_TARGET'})
})
test('input resource validation rejects overflow at each declared boundary',()=>{
 assert.equal(typeof api.validateResourceUsage,'function','resource validator is implemented')
 for(const usage of [{compressedBytes:536870913},{unpackedBytes:2147483649},{entries:100001},{depth:65},{items:21}])assert.throws(()=>api.validateResourceUsage(usage),{code:'RESOURCE_LIMIT'})
 assert.doesNotThrow(()=>api.validateResourceUsage({compressedBytes:536870912,unpackedBytes:2147483648,entries:100000,depth:64,items:20}))
})
