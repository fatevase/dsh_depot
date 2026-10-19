import {readFile,mkdir,writeFile} from 'node:fs/promises'
import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import path from 'node:path'
import {Github} from '../lib/github.mjs'
import {fileHash,atomicJson} from '@dsh-depot/offline-format/files'
import {qualifyManagerReport} from './verify.mjs'
import {latestManagerCatalog} from '../lib/manager-catalog.mjs'
import {managerCatalogOf} from './ci.mjs'
import {fail} from '@dsh-depot/offline-format/constants'
export async function prepareReleaseFiles(plan,{directory,tag,previous={packages:[]}}){
 if(!/^manager-\d+$/.test(tag)||!plan.assets?.length)fail('PUBLICATION_DENIED','需要精确的已验收资产')
 await mkdir(directory,{recursive:true});const publicAssets=[]
 for(const asset of plan.assets){if(await fileHash(asset.path)!==asset.sha256||path.basename(asset.fileName)!==asset.fileName||qualifyManagerReport(asset.verification??{}).status!=='passed')fail('ASSET_CHANGED','资产字节或验收状态不符');publicAssets.push({...asset,packageUrl:`https://github.com/fatevase/dsh_depot/releases/download/${tag}/${asset.fileName}`})}
 const merged=new Map((previous.packages??[]).map(p=>[p.target+':'+p.flavor,p]));for(const p of publicAssets.filter(p=>['full','lite'].includes(p.flavor)))merged.set(p.target+':'+p.flavor,p)
 const catalog=managerCatalogOf([...merged.values()],previous.support??{})
 const catalogFile=path.join(directory,'manager-catalog.json'),reportFile=path.join(directory,'manager-verification.json'),sums=path.join(directory,'SHA256SUMS')
 await atomicJson(catalogFile,catalog);await atomicJson(reportFile,{schemaVersion:1,assets:publicAssets.map(a=>({fileName:a.fileName,sha256:a.sha256,verification:a.verification}))})
 const files=[...publicAssets.map(a=>a.path),catalogFile,reportFile]
 await writeFile(sums,(await Promise.all(files.map(async file=>`${await fileHash(file)}  ${path.basename(file)}`))).join('\n')+'\n')
 return{files:[...files,sums],catalog}
}
async function main(file){
 if(process.env.GITHUB_EVENT_NAME!=='workflow_dispatch'||process.env.GH_REPO!=='fatevase/dsh_depot')fail('PUBLICATION_DENIED','只能从授权仓库人工发布')
 const plan=JSON.parse(await readFile(file,'utf8')),tag=`manager-${process.env.GITHUB_RUN_ID}`
 const previous=await latestManagerCatalog({github:new Github({token:process.env.GH_TOKEN})}),prepared=await prepareReleaseFiles(plan,{directory:path.join(path.dirname(file),'release'),tag,previous})
 const run=args=>{const r=spawnSync('gh',args,{stdio:'inherit',shell:false});if(r.status!==0)fail('RELEASE_FAILED','GitHub 发布未完成，已保留草稿或原记录')}
 run(['release','create',tag,...prepared.files,'--draft','--target',process.env.GITHUB_SHA,'--title','DSH 离线插件管理器','--notes','仅包含通过对应平台完整验收的安装包。校验和、兼容范围与报告随包提供。'])
 run(['release','edit',tag,'--draft=false'])
 for(const p of prepared.catalog.packages){const r=await fetch(p.packageUrl,{method:'HEAD',signal:AbortSignal.timeout(30000)});if(!r.ok)fail('PUBLIC_LINK_FAILED','发布链接不可访问：'+p.fileName)}
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===path.resolve(process.argv[1]))main(process.argv[2]).catch(e=>{console.error(e.code??'PUBLICATION_FAILED',e.message);process.exitCode=1})
