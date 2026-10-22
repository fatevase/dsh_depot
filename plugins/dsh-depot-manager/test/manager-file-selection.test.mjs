import test from 'node:test'
import assert from 'node:assert/strict'
const {createFileSelection}=await import('../plugin/client/file-selection.mjs').catch(()=>({}))
test('a directory read completing after modal disposal cannot replace a newer selection',async()=>{
 assert.equal(typeof createFileSelection,'function');const selected=[];let finish
 const old=createFileSelection(groups=>selected.push(groups)),pending=old.read(()=>new Promise(r=>finish=r))
 old.dispose();const current=createFileSelection(groups=>selected.push(groups));await current.read(async()=>['new.tgz']);finish(['old-folder']);await pending
 assert.deepEqual(selected,[['new.tgz']])
})
test('the most recent selection wins even when an earlier folder read finishes last',async()=>{
 assert.equal(typeof createFileSelection,'function');const selected=[];let finish
 const reader=createFileSelection(groups=>selected.push(groups)),pending=reader.read(()=>new Promise(r=>finish=r));await reader.read(async()=>['new.tgz']);finish(['old-folder']);await pending
 assert.deepEqual(selected,[['new.tgz']])
})
