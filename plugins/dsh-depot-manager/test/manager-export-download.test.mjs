import test from 'node:test'
import assert from 'node:assert/strict'
import {Readable} from 'node:stream'
import {exportDownloadResponse} from '../plugin/host/export-download.mjs'
test('download streams authenticated service bytes with safe headers and releases a cancelled lease',async()=>{
 let released=0,id;const response=await exportDownloadResponse(new Request('http://localhost/api/depot/export-download?id=job'),{async openDownload(value){id=value;return {stream:Readable.from([Buffer.from('archive')]),fileName:'fixture-1.0.0-macos-arm64.tgz',bytes:7,release:()=>released++}}})
 assert.equal(id,'job');assert.equal(response.headers.get('content-type'),'application/octet-stream');assert.match(response.headers.get('content-disposition'),/attachment/);assert.equal(await response.text(),'archive');assert.equal(released,1)
 await assert.rejects(exportDownloadResponse(new Request('http://localhost/api/depot/export-download?id=bad'),{async openDownload(){throw Object.assign(new Error('denied'),{code:'FORBIDDEN'})}}),{code:'FORBIDDEN'})
})
