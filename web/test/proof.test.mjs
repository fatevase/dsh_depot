import test from 'node:test'
import assert from 'node:assert/strict'
test('proof distinguishes a failed check, a missing check and an inapplicable native probe',async()=>{
 const {verificationRows}=await import('../proof.mjs')
 const rows=verificationRows({verification:{status:'unverified',scope:['cold-install','config-compose','host-page-smoke'],checks:{install:true,compose:false,native:true}}})
 assert.equal(rows.find(r=>r.id==='install').state,'passed')
 assert.equal(rows.find(r=>r.id==='compose').state,'failed')
 assert.equal(rows.find(r=>r.id==='host').state,'missing')
 assert.equal(rows.find(r=>r.id==='native').state,'not-applicable')
 assert.equal(rows.find(r=>r.id==='business').state,'not-covered')
})
