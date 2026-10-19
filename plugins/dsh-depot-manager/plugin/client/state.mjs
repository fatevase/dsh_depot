export const emptyState=()=>({host:null,imports:[],installed:[],operations:[],selection:null,connection:'connecting'})
const upsert=(rows,value,key)=>rows.some(x=>x[key]===value[key])?rows.map(x=>x[key]===value[key]?value:x):[...rows,value]
export function reduceManagerState(state=emptyState(),event) {
 switch(event.type){
  case 'host':return {...state,host:event.value,connection:'connected'}
  case 'import':return {...state,imports:upsert(state.imports,event.value,'importId')}
  case 'dismiss-import':return {...state,imports:state.imports.filter(item=>item.importId!==event.importId)}
  case 'operation':return {...state,operations:upsert(state.operations,event.value,'operationId')}
  case 'installed':case 'operations':return {...state,[event.type]:event.value}
  case 'select':return {...state,selection:event.value}
  case 'connection':return {...state,connection:event.value}
  default:return state
 }
}
export const stateLabel=state=>({inspecting:'正在检查',ready:'待确认',blocked:'已阻止',queued:'等待执行',waiting_for_host_exit:'等待退出 DSH · 请运行外部脚本',backing_up:'备份中',applying:'正在安装',checking_install:'检查安装结果',awaiting_reload:'已安装 · 等待 DSH 加载',succeeded:'已加载',recovering:'恢复中',failed:'安装未完成 · 未自动回滚',failed_restored:'失败 · 已恢复原状态',recovery_required:'需要检查恢复点 · 请运行外部脚本',cancelled:'已取消'})[state]??state
