import {readdir,stat,rm,readFile} from 'node:fs/promises'
import path from 'node:path'
import {parse as parseYaml} from 'yaml'
import {LIMITS} from '../contracts/constants.mjs'
import {operationsIn,checkedId,withManagerLock,saveOperation} from './receipts.mjs'
import {readJson} from './files.mjs'
export function pruneRetention(context,now=Date.now()){
 return context.hostId?withManagerLock(context.storeDir,context.hostId,()=>prune(context,now)):prune(context,now)
}
async function prune({storeDir,profileDir},now){
 const operations=await operationsIn(storeDir),removed=[],retained=[],blockedReasons=[],live=new Set(operations.filter(o=>!['succeeded','failed_restored','cancelled'].includes(o.state)).map(o=>o.operationId).filter(Boolean)),protectedIds=new Set(operations.filter(o=>!['succeeded','failed_restored','cancelled'].includes(o.state)).map(o=>o.snapshotId).filter(Boolean))
 const successful=operations.filter(o=>(o.state==='succeeded'||(o.state==='cancelled'&&o.result?.installed))&&o.snapshotId).sort((a,b)=>b.createdAt-a.createdAt)
 for(const [i,o]of successful.entries()){if(i<LIMITS.recoveryCount||protectedIds.has(o.snapshotId)){retained.push(o.snapshotId);continue}await rm(path.join(storeDir,'snapshots',checkedId(o.snapshotId)),{recursive:true,force:true});removed.push(o.snapshotId);if(o.operationId){o.prunedSnapshotId=o.snapshotId;o.snapshotId=null;o.snapshot=null;await saveOperation(o,{storeDir})}}
 for(const o of operations.filter(o=>o.state==='failed_restored'&&o.snapshotId)){if(now-o.createdAt>LIMITS.recoveryTtlMs&&!protectedIds.has(o.snapshotId)){await rm(path.join(storeDir,'snapshots',checkedId(o.snapshotId)),{recursive:true,force:true});removed.push(o.snapshotId);if(o.operationId){o.prunedSnapshotId=o.snapshotId;o.snapshotId=null;o.snapshot=null;await saveOperation(o,{storeDir})}}else retained.push(o.snapshotId)}
 for(const id of protectedIds){retained.push(id);blockedReasons.push('恢复中的快照不可清理：'+id)}
 const referenced=new Set(operations.filter(o=>live.has(o.operationId)||retained.includes(o.snapshotId)).map(o=>o.plan?._inspection?.importId).filter(Boolean)),stores=[]
 async function protectProfile(root){
  const p=await readJson(path.join(root,'package.json'),{})
  for(const spec of Object.values({...p.dependencies,...p.optionalDependencies,...p.devDependencies})){if(typeof spec!=='string'||!spec.startsWith('file:'))continue;const file=path.resolve(root,spec.slice(5)),relative=path.relative(path.join(storeDir,'imports'),file);if(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative))referenced.add(relative.split(path.sep)[0])}
  try{const store=parseYaml(await readFile(path.join(root,'node_modules/.modules.yaml'),'utf8'))?.storeDir;if(typeof store==='string')stores.push(path.resolve(store))}catch(e){if(e.code!=='ENOENT')throw e}
 }
 for(const op of operations.filter(o=>o.batched&&live.has(o.operationId))){const b=await readJson(path.join(storeDir,'batches',checkedId(op.operationId)+'.json'),{});for(const item of b.items??[])if(item.inspection?.importId)referenced.add(item.inspection.importId)}
 if(profileDir)await protectProfile(profileDir)
 for(const id of new Set(retained))await protectProfile(path.join(storeDir,'snapshots',checkedId(id),'payload'))
 for(const [kind,protect]of [['imports',id=>referenced.has(id)],['stores',id=>live.has(id)||stores.some(s=>s.startsWith(path.resolve(storeDir,'stores',id)+path.sep))]]){
  let ids=[];try{ids=await readdir(path.join(storeDir,kind))}catch(e){if(e.code!=='ENOENT')throw e}
  for(const id of ids){if(!/^[a-f0-9-]{36}$/.test(id)||protect(id))continue;const dir=path.join(storeDir,kind,id),s=await stat(dir);if(now-s.mtimeMs>LIMITS.stagingTtlMs){await rm(dir,{recursive:true,force:true});removed.push(kind+':'+id)}}
 }
 return{removed,retained:[...new Set(retained)],blockedReasons}
}
