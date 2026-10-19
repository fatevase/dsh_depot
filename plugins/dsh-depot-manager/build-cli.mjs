import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {parseArgs} from 'node:util'
import {runtimeTarget} from '@dsh-depot/offline-format/platform'
import {buildManager} from './build.mjs'
import {buildBootstrap} from './build-bootstrap.mjs'
export async function main(args=process.argv.slice(2)){
 const {values}=parseArgs({args,options:{target:{type:'string',default:runtimeTarget(process.platform,process.arch)},flavor:{type:'string',default:'lite'},output:{type:'string'},'runtime-archive':{type:'string'}}})
 if(!['plugin','lite','full'].includes(values.flavor))throw Error('flavor must be plugin, lite or full')
 const output=path.resolve(values.output??fileURLToPath(new URL('../../.runtime/manager-local',import.meta.url)))
 const manager=await buildManager({target:values.target,output})
 const bundle=values.flavor==='plugin'?null:await buildBootstrap({target:values.target,flavor:values.flavor,managerArchive:manager.path,output,runtimeArchive:values['runtime-archive']?path.resolve(values['runtime-archive']):undefined})
 return{manager,bundle}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().then(r=>console.log(JSON.stringify(r)),e=>{console.error(e.code??'BUILD_FAILED',e.message);process.exitCode=1})
