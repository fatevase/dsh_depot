import { isDownloadablePackage, isUnverifiedPackage, verificationMessage } from '@dsh-depot/offline-format/package-status'
export { isUnverifiedPackage, verificationMessage }
import {categoryKey} from './categories.mjs'
export {categories} from './categories.mjs'
export const platforms = {all:'全部平台','macos-arm64':'macOS · arm64','linux-x64':'Linux · x64','win32-x64':'Windows · x64'}
export const packagesFor = (catalog,id) => catalog.packages.filter(p=>p.recipeId===id&&isDownloadablePackage(p)&&(!catalog.latest||Object.values(catalog.latest).includes(p.buildKey)))
export function platformState(catalog,plugin,target){
 const published=packagesFor(catalog,plugin.id).find(p=>p.target===target)
 if(published)return {label:isUnverifiedPackage(published)?'未验证 · 可下载':'已验证 · 可下载',package:published,unverified:isUnverifiedPackage(published)}
 const trial=plugin.trial?.results?.[target]
 if(trial){
  if(trial.status==='compiled')return {label:'已构建 · 未离线验证',message:'已完成源码编译打包或固定成品包检查，尚未完成离线安装验证。可直接下载已发布的构建包；构建步骤和检查结果见站内记录。',unverified:true,trial}
  if(trial.status==='failed')return {label:'构建失败',message:trial.error??'本次编译或打包失败。',trial}
  return {label:'未收到构建结果',message:'本次没有收到该平台的构建结果。',trial}
 }
 const decision=catalog.decisions?.find(d=>d.recipeId===plugin.id&&d.target===target)
 if(plugin.status==='needs_recipe'||decision?.action==='needs_recipe')return {label:'待适配',message:plugin.availabilityNote??'这个插件的构建适配尚未完成，当前没有可下载的离线包。'}
 if(decision?.action==='queued')return {label:'排队待构建',message:'已满足构建规则，因本批任务上限留待下一轮处理。'}
 const issue=decision?.buildKey?catalog.issues?.find(r=>r.buildKey===decision.buildKey):undefined
 if(issue?.status==='unverified'||issue?.stage==='verify')return {label:'验证未通过',message:issue.error?.message==='Network isolation controls failed'?'已执行打包，但验证环境的网络隔离检查未通过，尚未完成可信的离线验证，因此没有发布安装包。':'已执行打包，但离线验证未通过，因此没有发布安装包。'}
 if(issue?.stage==='build'||issue?.status==='failed')return {label:'构建失败',message:'本次编译或打包失败，尚未生成可下载的安装包。'}
 if(decision?.action==='needs_attention')return {label:'构建或验证失败',message:'本次处理未通过，需要修复后重新构建与验证。当前没有可下载的离线包。'}
 return {label:'尚未发布',message:'对应平台完成构建与空缓存离线验证并发布后，这里会提供下载和安装命令。'}
}
export function selectPlugins(catalog,{q='',category='all',platform='all',verified=false,sort='curated'}={}){
 const query=q.trim().toLocaleLowerCase()
 const list=catalog.plugins.filter(p=>(!query||[p.name,p.repository,p.npmName,p.description,p.label].join(' ').toLocaleLowerCase().includes(query))&&(category==='all'||categoryKey(p.category)===categoryKey(category))).map(p=>({...p,packages:packagesFor(catalog,p.id).filter(a=>(platform==='all'||a.target===platform)&&(!verified||a.verification?.status==='passed'))})).filter(p=>!verified||p.packages.some(a=>a.verification?.status==='passed'))
 if(sort==='name')list.sort((a,b)=>a.name.localeCompare(b.name))
 const time=value=>Number.isFinite(Date.parse(value))?Date.parse(value):0
 if(sort==='updated')list.sort((a,b)=>time(b.upstreamUpdatedAt)-time(a.upstreamUpdatedAt))
 if(sort==='released')list.sort((a,b)=>Math.max(0,...b.packages.map(p=>time(p.publishedAt)))-Math.max(0,...a.packages.map(p=>time(p.publishedAt))))
 if(sort==='small'||sort==='size')list.sort((a,b)=>Math.min(...a.packages.map(p=>p.compressedBytes),Infinity)-Math.min(...b.packages.map(p=>p.compressedBytes),Infinity))
 return list
}
export const dateLabel=value=>Number.isFinite(Date.parse(value))?new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value)):'暂无记录'
export const searchUrl = params => `plugins.html${params.toString()?'?'+params.toString():''}`
export const bytes = n => Number.isFinite(n) ? `${(n/1e6).toFixed(2)} MB` : '尚未发布'
export function downloadUrl(value){try{const u=new URL(value);return u.protocol==='https:'&&u.hostname==='github.com'?u.href:null}catch{return null}}

export function installCommand(p){
 if(!/^[a-zA-Z0-9._+-]+\.tgz$/.test(p.fileName??''))throw new Error('Unsafe package filename')
 return `dsh plugin --profile web add "./${p.fileName}" --offline --ignore-scripts`
}
