import {authorizeJob} from './channel.mjs'
import {atomicJson} from '../core/files.mjs'
import {fail} from '../contracts/constants.mjs'
export async function workerMain(options) {
 const job=await authorizeJob(options)
 if(typeof options.execute!=='function')fail('RESUME_FROM_SCRIPT','请从安装脚本恢复；此宿主未验证退出后继续运行的能力')
 const result=await options.execute(job.plan)
 await atomicJson(options.jobPath+'.result.json',{operationId:result.operationId??null,state:result.state,hostId:job.hostId,updatedAt:Date.now()})
 return result
}
