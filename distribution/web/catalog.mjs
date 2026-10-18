export const categories = {all:'全部插件',interface:'界面体验',workspace:'工作空间',tools:'实用工具'}
export const platforms = {all:'全部平台','darwin-arm64':'macOS · arm64','linux-x64':'Linux · x64','win32-x64':'Windows · x64'}
export const packagesFor = (catalog,id) => catalog.packages.filter(p=>p.recipeId===id&&p.status==='published'&&p.verification?.status==='passed'&&(!catalog.latest||Object.values(catalog.latest).includes(p.buildKey)))
export function selectPlugins(catalog,{q='',category='all',platform='all',verified=false,sort='curated'}={}){
 const query=q.trim().toLocaleLowerCase()
 const list=catalog.plugins.filter(p=>(!query||[p.name,p.repository,p.npmName,p.description,p.label].join(' ').toLocaleLowerCase().includes(query))&&(category==='all'||p.category===category)).map(p=>({...p,packages:packagesFor(catalog,p.id).filter(a=>platform==='all'||a.target===platform)})).filter(p=>!verified||p.packages.length)
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
