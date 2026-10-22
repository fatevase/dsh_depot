// Trusted metadata-only update: upstream scripts never execute in this workflow.
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {mkdir,readFile,writeFile,readdir,copyFile} from 'node:fs/promises'
import {execFileSync} from 'node:child_process'
import semver from 'semver'
import {Github} from './lib/github.mjs'
import {readJson,atomicJson,jsonDigest} from './lib/model.mjs'
import {latestHostVersion,latestSource,assertLatestRef,runtimeManifest,freezeRuntimeVersions} from './lib/latest.mjs'
import {prepareTools,isolatedEnv,runCommand} from './lib/process.mjs'
const root=path.resolve('.runtime/latest-update'),repository='fatevase/dsh_depot'
const github=new Github({token:process.env.GITHUB_TOKEN})
const jsonFile=async(file,value)=>{await writeFile(file,JSON.stringify(value,null,2)+'\n')}
async function refresh(){
 await mkdir(root,{recursive:true})
 const config=await readJson('distribution/config.json'),previousHost=config.host.version,version=await latestHostVersion(),errors=[],plugins=[]
 config.host.version=version;config.versionPolicy={host:'npm-latest',plugins:'latest-release-or-tag-otherwise-default-branch',history:'current-only',includeHostPrerelease:true}
 await jsonFile('distribution/config.json',config)
 const host=await readJson('distribution/host/package.json');host.dependencies['@deepseek-ai/dsh']=version;await jsonFile('distribution/host/package.json',host)
 const tools=await prepareTools({node:config.host.node,npm:'11.19.1',pnpm:'11.25.0'},path.join(root,'tools'))
 const env=await isolatedEnv(path.join(root,'environment'),{bin:tools.bin});env.npm_config_registry=config.registry
 if(previousHost!==version){
  const result=await runCommand({argv:[...tools.pnpm,'install','--lockfile-only','--ignore-scripts','--config.manage-package-manager-versions=false','--config.minimumReleaseAge=0'],cwd:path.resolve('distribution/host'),env,logFile:path.join(root,'host-lock.log'),timeoutMs:480000})
  if(result.exitCode)throw Error('Latest DSH dependency lock failed: '+result.output.slice(-1000))
  const manager=await readJson('plugins/dsh-depot-manager/plugin/package.json'),old=manager.engines?.dsh??manager.peerDependencies['@deepseek-ai/dsh-app-boot']
  const supported=[...new Set([...old.split(' || '),version])]
  manager.engines.dsh=supported.join(' || ')
  for(const name of Object.keys(manager.peerDependencies))manager.peerDependencies[name]=manager.engines.dsh
  manager.version=semver.inc(manager.version,'patch')
  await jsonFile('plugins/dsh-depot-manager/plugin/package.json',manager)
 }
 for(const file of (await readdir('distribution/recipes')).filter(f=>f.endsWith('.json')).sort()){
  const recipeFile='distribution/recipes/'+file,r=await readJson(recipeFile)
  if(!r.enabled)continue
  r.latestOnly=true;r.hostRange=version
  try{
   const selected=await latestSource(r,github),prefix=r.packagePath==='.'?'':r.packagePath+'/',manifest=JSON.parse(await github.text(r.repository,prefix+'package.json',selected.commit))
   if(manifest.name!==r.npmName||!semver.valid(manifest.version))throw Error('Latest package identity/version changed')
   const declared=typeof manifest.repository==='object'?manifest.repository.url:manifest.repository
   if(declared&&!declared.replace(/^git\+/,'').replace(/\.git$/,'').toLowerCase().endsWith('/'+r.repository.toLowerCase()))throw Error('Latest package repository identity changed')
   assertLatestRef(r,selected)
   if(selected.channel!=='branch')r.releasePins={...r.releasePins,[selected.ref]:selected.commit}
   const changed=r.seed?.commit!==selected.commit||r.seed?.version!==manifest.version
   r.channel={type:'fixed',ref:selected.commit,allowPrerelease:!!r.channel.allowPrerelease}
   r.seed={ref:selected.ref,commit:selected.commit,version:manifest.version,...(!changed&&r.seed.archiveSha256?{archiveSha256:r.seed.archiveSha256}:{})}
   r.latestOnly=true;r.allowedVersions=manifest.version;r.hostRange=version
   r.distributionScope='跟进上游最新发布版；无发布版时跟进默认分支。每次构建固定源码与依赖，并在当前 DSH 上重新验证。'
   r.upstreamChannel=selected.channel
   if(changed||r.latestRefreshError){
    const runtime=runtimeManifest(manifest,r),directory=path.join(root,'runtime',r.id);await mkdir(directory,{recursive:true});await jsonFile(path.join(directory,'package.json'),runtime)
    // Resolve only registry metadata into a fresh adapter lock. No source hooks.
    await writeFile(path.join(directory,'package-lock.json'),JSON.stringify({name:runtime.name,version:runtime.version,lockfileVersion:3,requires:true,packages:{'':runtime}}))
    const result=await runCommand({argv:[...tools.npm,'install','--package-lock-only','--ignore-scripts','--legacy-peer-deps','--no-audit','--no-fund'],cwd:directory,env,logFile:path.join(root,`${r.id}-runtime-lock.log`),timeoutMs:180000})
    if(result.exitCode)throw Error('Latest runtime lock failed: '+result.output.slice(-800))
    const lock=freezeRuntimeVersions(runtime,await readJson(path.join(directory,'package-lock.json')))
    const descriptor=r.locks?.runtime
    if(descriptor?.origin!=='adapter')throw Error('Runtime recipe requires manual adaptation')
    await jsonFile(path.join('distribution',descriptor.file),lock)
   }
   delete r.latestRefreshError
   plugins.push({id:r.id,version:manifest.version,commit:selected.commit,channel:selected.channel,changed})
  }catch(error){r.latestRefreshError=error.message;errors.push({id:r.id,message:error.message})}
  await jsonFile(recipeFile,r)
 }
 const report={schemaVersion:1,host:{previous:previousHost,version,changed:previousHost!==version},plugins,errors}
 await atomicJson(path.join(root,'report.json'),report)
 console.log(JSON.stringify(report))
}
function trackedChanges(){return execFileSync('git',['diff','--name-only'],{encoding:'utf8'}).trim().split('\n').filter(Boolean)}
const allowed=file=>/^distribution\/(config\.json|host\/(package\.json|pnpm-lock\.yaml)|recipes\/[a-z0-9-]+\.json|locks\/[a-z0-9-]+\.json)$/.test(file)||file==='plugins/dsh-depot-manager/plugin/package.json'
async function snapshot(){
 const files=trackedChanges();if(files.some(f=>!allowed(f)))throw Error('Unexpected file in latest update')
 const report=await readJson(path.join(root,'report.json'))
 await atomicJson(path.join(root,'snapshot.json'),{base:process.env.GITHUB_SHA??execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),hostChanged:report.host.changed,files:await Promise.all(files.map(async file=>({path:file,mode:'100644',type:'blob',content:await readFile(file,'utf8')})))})
 if(process.env.GITHUB_OUTPUT)await import('node:fs/promises').then(fs=>fs.appendFile(process.env.GITHUB_OUTPUT,`changed=${files.length>0}\n`))
}
async function publish(){
 if(process.env.GITHUB_REPOSITORY!==repository||process.env.GITHUB_REF!=='refs/heads/main')throw Error('Latest updates may only publish from the distribution main branch')
 const snapshot=await readJson(path.join(root,'snapshot.json')),base=`/repos/${repository}`
 if(!/^[a-f0-9]{40}$/.test(snapshot.base)||snapshot.files.some(f=>!allowed(f.path)||f.mode!=='100644'||f.type!=='blob'||typeof f.content!=='string'))throw Error('Invalid latest update snapshot')
 if(snapshot.files.length){
  const ref=(await github.request(base+'/git/refs/heads/main')).data
  if(ref.object.sha!==snapshot.base)throw Error('Main changed during latest update; retry from the new head')
  const parent=(await github.request(base+'/git/commits/'+snapshot.base)).data
  const tree=(await github.request(base+'/git/trees',{method:'POST',body:{base_tree:parent.tree.sha,tree:snapshot.files}})).data
  const commit=(await github.request(base+'/git/commits',{method:'POST',body:{message:'chore: refresh latest DSH and plugin source pins',tree:tree.sha,parents:[snapshot.base]}})).data
  await github.request(base+'/git/refs/heads/main',{method:'PATCH',body:{sha:commit.sha,force:false}})
  console.log('Updated latest distribution inputs: '+commit.sha)
 }
 // A GITHUB_TOKEN commit does not emit push workflows; explicit dispatch does.
 for(const workflow of ['plugin-distribution.yml',...(snapshot.hostChanged?['manager-distribution.yml']:[])])await github.request(base+`/actions/workflows/${workflow}/dispatches`,{method:'POST',body:{ref:'main',...(workflow==='manager-distribution.yml'?{inputs:{publish:true,channel:'preview'}}:{})}})
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const command=process.argv[2]??'refresh'
 if(command==='refresh')await refresh()
 else if(command==='snapshot')await snapshot()
 else if(command==='publish')await publish()
 else throw Error('Usage: update-latest.mjs refresh|snapshot|publish')
}
