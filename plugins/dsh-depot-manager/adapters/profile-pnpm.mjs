import path from 'node:path'
import {readFile,realpath,mkdir} from 'node:fs/promises'
import {parse as parseYaml} from 'yaml'
import semver from 'semver'
import {fileHash,readJson} from '../core/files.mjs'
import {extractSafeArchive} from '../core/archive.mjs'
import {runHostCommand} from './command.mjs'
import {fail} from '../contracts/constants.mjs'
const canonical=async file=>await realpath(file).catch(()=>path.resolve(file))
export async function resolveProfilePnpm(host,{toolkit,workDir}={}){
 let modules;try{modules=parseYaml(await readFile(path.join(host.profileDir,'node_modules/.modules.yaml'),'utf8'))}catch(e){if(e.code!=='ENOENT')throw e}
 if(!toolkit?.packageManagers){if(modules?.packageManager)fail('COMPATIBLE_TOOLKIT_REQUIRED','请使用附带兼容包管理工具的新版完整安装包');return{...host.packageManager,storeDir:undefined}}
 const archive=path.join(toolkit.root,'package-managers.tgz');if(await fileHash(archive)!==toolkit.packageManagers.sha256)fail('BUNDLE_HASH_MISMATCH','兼容包管理工具校验失败，请重新解压安装包')
 const root=path.join(workDir,'package-managers');await mkdir(workDir,{recursive:true,mode:0o700});await extractSafeArchive(archive,root)
 const index=await readJson(path.join(root,'index.json')),major=modules?.packageManager?Number(/^pnpm@(\d+)\./.exec(modules.packageManager)?.[1]):11
 const selected=index.versions.find(p=>p.major===major)
 if(!selected)fail('PACKAGE_MANAGER_UNSUPPORTED',`现有配置使用 ${modules?.packageManager}，当前离线工具尚未包含对应版本；不会更改现有 store`)
 if(!semver.satisfies(toolkit.nodeVersion??process.versions.node,selected.nodeRange))fail('RUNTIME_UNSUPPORTED','请使用附带兼容运行时的完整包')
 const command=toolkit.nodePath,args=[path.join(root,selected.entry)],env={npm_config_offline:'true',npm_config_ignore_scripts:'true',COREPACK_ENABLE_NETWORK:'0',npm_config_manage_package_manager_versions:'false'}
 if(modules?.storeDir){
  const result=await runHostCommand({executable:command,args:[...args,'store','path','--config.manage-package-manager-versions=false','--store-dir',modules.storeDir],cwd:host.profileDir,envAllowlist:env},{timeoutMs:15000})
  const resolved=result.stdout.trim().split(/\r?\n/).at(-1)
  if(result.exitCode||!resolved||await canonical(resolved)!==await canonical(modules.storeDir))fail('STORE_COMPATIBILITY_FAILED','包管理工具未能复用现有 store；未修改配置或全局设置')
 }
 return{command,args,env,version:selected.version,storeDir:modules?.storeDir}
}
