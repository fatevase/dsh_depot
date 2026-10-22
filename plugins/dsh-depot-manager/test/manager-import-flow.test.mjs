import test from 'node:test'
import assert from 'node:assert/strict'
const {prepareImports,installPrepared}=await import('../plugin/client/import-flow.mjs').catch(()=>({}))
test('dropping files prepares each package without installing, then confirmation installs exactly those imports',async()=>{
 assert.equal(typeof prepareImports,'function');const calls=[],client={importFiles:async files=>({importId:files[0].file.name,packageName:'fixture',checks:{},warnings:[],blockers:[]}),plan:async input=>{calls.push(input);return{planId:input.importId}},start:async id=>({operationId:id,state:'awaiting_reload'})}
 const prepared=await prepareImports(client,[[{file:{name:'one.tgz'}}],[{file:{name:'two.tgz'}}]]);assert.equal(calls.length,0);assert.equal(prepared.length,2)
 const results=await installPrepared(client,prepared);assert.deepEqual(results.map(x=>x.operationId),['one.tgz','two.tgz']);assert.equal(calls[0].acceptUnverified,true)
})
test('a blocked package prevents the whole confirmation from installing a partial selection',async()=>{
 assert.equal(typeof installPrepared,'function');let installed=false;const client={plan:async()=>{installed=true}}
 await assert.rejects(()=>installPrepared(client,[{importId:'ok'},{importId:'bad',blockers:[{code:'INVALID_TARGET',message:'平台不匹配'}]}]),/平台不匹配/);assert.equal(installed,false)
 await assert.rejects(()=>installPrepared(client,[]),/选择/)
})
