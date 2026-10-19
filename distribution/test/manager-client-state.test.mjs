import test from 'node:test'
import assert from 'node:assert/strict'
const mod=await import('../manager/plugin/client/state.mjs').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return{};throw e})
test('partial batch failures preserve other results and awaiting reload is never loaded',()=>{assert.equal(typeof mod.reduceManagerState,'function');let s=mod.reduceManagerState(undefined,{type:'operation',value:{operationId:'a',state:'awaiting_reload',result:{loaded:false}}});s=mod.reduceManagerState(s,{type:'operation',value:{operationId:'b',state:'failed_restored'}});assert.equal(s.operations.length,2);assert.equal(s.operations[0].result.loaded,false);assert.match(mod.stateLabel(s.operations[0].state),/等待/);assert.notEqual(mod.stateLabel(s.operations[0].state),mod.stateLabel('succeeded'))})
