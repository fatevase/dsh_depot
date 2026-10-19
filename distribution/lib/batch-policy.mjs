// The planner decides what is safe to build. This only budgets its approved work.
export function selectBuildBatch(plan,{policy,state={},recipeOrder=[],retryKeys=[]}={}){
 if(!policy)return plan
 if(!Number.isSafeInteger(policy.maxPlugins)||policy.maxPlugins<1||policy.maxPlugins>80||!Number.isSafeInteger(policy.maxTasks)||policy.maxTasks<1||policy.maxTasks>240)throw Error('Invalid batch budget')
 const groups=new Map(),lastAttempt=new Map(),rank=new Map(recipeOrder.map((id,i)=>[id,i]))
 for(const receipt of Object.values(state.receipts??{})){
  const time=Date.parse(receipt.attempt)
  if(Number.isFinite(time))lastAttempt.set(receipt.recipeId,Math.max(lastAttempt.get(receipt.recipeId)??0,time))
 }
 for(const task of plan.tasks){if(!groups.has(task.recipeId))groups.set(task.recipeId,[]);groups.get(task.recipeId).push(task)}
 if([...groups.values()].some(tasks=>tasks.length>policy.maxTasks))throw Error('Batch budget cannot fit one complete plugin group')
 const retried=([id,tasks])=>retryKeys.includes(id)||tasks.some(t=>retryKeys.includes(t.buildKey))
 const ordered=[...groups].sort((a,b)=>Number(retried(b))-Number(retried(a))||(lastAttempt.get(a[0])??0)-(lastAttempt.get(b[0])??0)||(rank.get(a[0])??Infinity)-(rank.get(b[0])??Infinity)||a[0].localeCompare(b[0]))
 const selected=[],pending=[],tasks=[]
 for(const [id,group] of ordered){
  if(selected.length<policy.maxPlugins&&tasks.length+group.length<=policy.maxTasks){selected.push(id);tasks.push(...group)}else pending.push(id)
 }
 const pendingKeys=new Set(plan.tasks.filter(t=>pending.includes(t.recipeId)).map(t=>t.buildKey))
 return {...plan,tasks,decisions:plan.decisions.map(d=>pendingKeys.has(d.buildKey)?{...d,action:'queued',reason:'Batch budget reached; next scheduled run will reconsider these inputs'}:d),batch:{limits:{...policy},selectedRecipeIds:selected,pendingRecipeIds:pending,selectedTasks:tasks.length,pendingTasks:pendingKeys.size}}
}
