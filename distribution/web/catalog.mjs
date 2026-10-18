import { isDownloadablePackage, isUnverifiedPackage, verificationMessage } from '../lib/package-status.mjs'
export { isUnverifiedPackage, verificationMessage }
export const categories = {all:'全部插件',interface:'界面体验',workspace:'工作空间',tools:'实用工具'}
export const platforms = {all:'全部平台','darwin-arm64':'macOS · arm64','linux-x64':'Linux · x64','win32-x64':'Windows · x64'}
export const packagesFor = (catalog,id) => catalog.packages.filter(p=>p.recipeId===id&&isDownloadablePackage(p)&&(!catalog.latest||Object.values(catalog.latest).includes(p.buildKey)))
export function platformState(catalog,plugin,target){
 const published=packagesFor(catalog,plugin.id).find(p=>p.target===target)
 if(published)return {label:isUnverifiedPackage(published)?'未验证 · 可下载':'已验证 · 可下载',package:published,unverified:isUnverifiedPackage(published)}
 const decision=catalog.decisions?.find(d=>d.recipeId===plugin.id&&d.target===target)
 if(plugin.status==='needs_recipe'||decision?.action==='needs_recipe')return {label:'待适配',message:plugin.availabilityNote??'这个插件的构建适配尚未完成，当前没有可下载的离线包。'}
 const issue=decision?.buildKey?catalog.issues?.find(r=>r.buildKey===decision.buildKey):undefined
 if(issue?.status==='unverified'||issue?.stage==='verify')return {label:'验证未通过',message:issue.error?.message==='Network isolation controls failed'?'已执行打包，但验证环境的网络隔离检查未通过，尚未完成可信的离线验证，因此没有发布安装包。':'已执行打包，但离线验证未通过，因此没有发布安装包。'}
 if(issue?.stage==='build'||issue?.status==='failed')return {label:'构建失败',message:'本次编译或打包失败，尚未生成可下载的安装包。'}
 if(decision?.action==='needs_attention')return {label:'构建或验证失败',message:'本次处理未通过，需要修复后重新构建与验证。当前没有可下载的离线包。'}
 return {label:'尚未发布',message:'对应平台完成构建与空缓存离线验证并发布后，这里会提供下载和安装命令。'}
}
export function selectPlugins(catalog,{q='',category='all',platform='all',verified=false,sort='curated'}={}){
 const query=q.trim().toLocaleLowerCase()
 const list=catalog.plugins.filter(p=>(!query||[p.name,p.repository,p.npmName,p.description,p.label].join(' ').toLocaleLowerCase().includes(query))&&(category==='all'||p.category===category)).map(p=>({...p,packages:packagesFor(catalog,p.id).filter(a=>(platform==='all'||a.target===platform)&&(!verified||a.verification?.status==='passed'))})).filter(p=>!verified||p.packages.some(a=>a.verification?.status==='passed'))
 if(sort==='name')list.sort((a,b)=>a.name.localeCompare(b.name))
 if(sort==='small'||sort==='size')list.sort((a,b)=>Math.min(...a.packages.map(p=>p.compressedBytes),Infinity)-Math.min(...b.packages.map(p=>p.compressedBytes),Infinity))
 return list
}
export const searchUrl = params => `plugins.html${params.toString()?'?'+params.toString():''}`
export const bytes = n => Number.isFinite(n) ? `${(n/1e6).toFixed(2)} MB` : '尚未发布'
export function downloadUrl(value){try{const u=new URL(value);return u.protocol==='https:'&&u.hostname==='github.com'?u.href:null}catch{return null}}

export function installCommand(p){
 if(!/^[a-zA-Z0-9._+-]+\.tgz$/.test(p.fileName??''))throw new Error('Unsafe package filename')
 return `dsh plugin --profile web add "./${p.fileName}" --offline --ignore-scripts`
}
