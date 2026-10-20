import {parentPort,workerData} from 'node:worker_threads'
import {collectExportGraph} from '../core/export-dependencies.mjs'
import {exportInstalledPackage} from '../core/export-package.mjs'
try{
 const graph=await collectExportGraph(workerData)
 parentPort.postMessage({type:'progress',value:{stage:'collecting',files:0,totalFiles:graph.budget.entries,unpackedBytes:graph.budget.bytes}})
 const result=await exportInstalledPackage({...workerData,graph,onProgress:value=>parentPort.postMessage({type:'progress',value})})
 parentPort.postMessage({type:'ready',value:{fileName:result.fileName,sha256:result.sha256,compressedBytes:result.compressedBytes,exclusions:graph.exclusions,warnings:result.warnings}})
}catch(e){parentPort.postMessage({type:'failed',value:{code:e.code??'EXPORT_FAILED',message:e.name==='ManagerError'?e.message:'读取或打包未完成，请确认源插件文件可用后重试'}})}
