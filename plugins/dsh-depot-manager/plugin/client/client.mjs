import {mount,unmount} from 'svelte'
import App from './App.svelte'
export function createManagerClient(transport) {
 const call=(method,input={})=>transport.call(method,input)
 return {
  createExport:input=>call('exports.create',input),exports:()=>call('exports.list'),exportStatus:exportId=>call('exports.status',{exportId}),cancelExport:exportId=>call('exports.cancel',{exportId}),
  current:()=>call('environment.current'),installed:()=>call('installed.list'),operations:()=>call('operations.list'),
  batchPlan:input=>call('batches.create',input),startBatch:batchId=>call('batches.start',{batchId}),
  plan:input=>call('plans.create',input),start:planId=>call('operations.start',{planId}),status:operationId=>call('operations.status',{operationId}),cancel:operationId=>call('operations.cancel',{operationId}),
  async importFiles(files){
   if(!files.length)throw new Error('没有选择文件')
   const session=await call('imports.create')
   for(const {file,relative} of files){
    for(let offset=0;offset<Math.max(file.size,1);offset+=262144){const end=Math.min(offset+262144,file.size);await transport.upload({importId:session.importId,relative,offset,final:end===file.size,blob:file.slice(offset,end)})}
   }
   return call('imports.finish',{importId:session.importId})
  }
 }
}
export const browserTransport={
 async call(method,input){const r=await fetch('/api/depot/rpc',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({method,input})});const body=await r.json();if(!body.ok)throw Object.assign(new Error(body.error.message),{code:body.error.code});return body.value},
 async upload({importId,relative,offset,final,blob}){const query=new URLSearchParams({id:importId,path:relative,offset:String(offset),final:final?'1':'0'});const r=await fetch('/api/depot/upload?'+query,{method:'POST',credentials:'same-origin',body:blob});const result=await r.json();if(!result.ok)throw Object.assign(new Error(result.error.message),{code:result.error.code});return result.value}
}
export function mountManager(container,client=createManagerClient(browserTransport),options={}) {const app=mount(App,{target:container,props:{client,...options}});return()=>unmount(app)}
