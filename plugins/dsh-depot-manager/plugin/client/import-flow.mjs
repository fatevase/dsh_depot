// File upload only prepares a selection. The single modal confirmation authorizes installation.
export async function prepareImports(client,groups,onProgress=()=>{}){
 if(!groups.length||groups.length>20)throw new Error('请选择 1—20 个离线包或成品文件夹')
 const items=[]
 for(const files of groups){
  try{items.push(await client.importFiles(files))}
  catch(e){items.push({importId:crypto.randomUUID(),packageName:files[0]?.file.name??'导入项',blockers:[{code:e.code,message:e.message}],warnings:[],checks:{}})}
  onProgress([...items])
 }
 return items
}
export async function installPrepared(client,items,onProgress=()=>{}){
 if(!items.length)throw new Error('请先选择离线包或成品文件夹')
 const blocker=items.flatMap(i=>i.blockers??[])[0]
 if(blocker)throw new Error(blocker.message??'所选插件未通过检查')
 const results=[]
 for(const item of items){
  const plan=await client.plan({action:'install',importId:item.importId,acceptUnverified:true})
  const operation=await client.start(plan.planId);results.push(operation);onProgress(operation)
  if(['failed','recovery_required','waiting_for_host_exit'].includes(operation.state))break
 }
 return results
}
