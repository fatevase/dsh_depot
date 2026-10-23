import test from 'node:test'
import assert from 'node:assert/strict'
const {registerManagerNavigation}=await import('../plugin/client/navigation.mjs').catch(()=>({}))
test('manager uses the standard left sidebar and a matching main panel, never a right or overlay slot',()=>{
 assert.equal(typeof registerManagerNavigation,'function')
 const seats=[],disposers=[],Panel=()=>null,Icon=()=>null
 const ctx={slots:{inject(name,build){const result=build();disposers.push(result);return result},register(options,component){seats.push({options,component});return()=>{seats.splice(seats.findIndex(x=>x.options===options),1)}}}}
 registerManagerNavigation(ctx,{Panel,Icon})
 assert.deepEqual(seats.map(x=>x.options.name),['main','sidebar.panellist']);assert.equal(seats[0].options.key,seats[1].options.id);assert.equal(seats[1].options.label(),'离线插件');assert.equal(seats[0].component,Panel);assert.equal(seats[1].component,Icon)
 for(const dispose of disposers)dispose();assert.equal(seats.length,0)
})
