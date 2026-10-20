import {Readable} from 'node:stream'
// Only register behind the same authenticated Connection registry used by RPC.
export async function exportDownloadResponse(request,service){
 const id=new URL(request.url).searchParams.get('id'),download=await service.openDownload(id)
 const reader=Readable.toWeb(download.stream).getReader();let finished=false
 const release=()=>{if(!finished){finished=true;download.release()}}
 const body=new ReadableStream({async pull(controller){try{const chunk=await reader.read();if(chunk.done){release();controller.close()}else controller.enqueue(chunk.value)}catch(e){release();controller.error(e)}},async cancel(reason){try{await reader.cancel(reason)}finally{release()}}})
 return new Response(body,{headers:{'content-type':'application/octet-stream','content-length':String(download.bytes),'content-disposition':`attachment; filename="${download.fileName}"`,'cache-control':'no-store','x-content-type-options':'nosniff'}})
}
