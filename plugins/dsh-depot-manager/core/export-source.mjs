import path from 'node:path'
import {createRequire} from 'node:module'
import {pathToFileURL} from 'node:url'
import {realpath} from 'node:fs/promises'
import semver from 'semver'
import {readJson,digest} from './files.mjs'
import {validPackageName} from '../contracts/validate.mjs'
import {fail} from '../contracts/constants.mjs'
import {isHostPackage} from '@dsh-depot/offline-format/host-packages'

export const bundleFingerprint=b=>digest(JSON.stringify({name:b.name,version:b.version,enabled:b.enabled,installed:b.installed}))
export async function resolveExportSource({host,bundle,resolveBundleDir}){
 if(!bundle?.installed||bundle.error||!validPackageName(bundle.name)||isHostPackage(bundle.name))fail('EXPORT_UNAVAILABLE','仅支持导出当前环境中已安装的非内置 DSH 插件')
 if(!resolveBundleDir){const req=createRequire(path.join(host.dshRoot,'package.json'));({resolveBundleDir}=await import(pathToFileURL(req.resolve('@deepseek-ai/dsh-app-boot')).href))}
 const root=await realpath(resolveBundleDir('dsh',bundle.name,path.join(host.dshRoot,'package.json'),host.profileDir))
 const manifest=await readJson(path.join(root,'package.json'))
 if(manifest.name!==bundle.name||!semver.valid(manifest.version)||bundle.version&&manifest.version!==bundle.version)fail('SOURCE_CHANGED','已安装插件身份发生变化，请刷新后重新导出')
 if(!manifest.dsh?.bundle?.patch)fail('EXPORT_UNAVAILABLE','此包没有 DSH 插件声明')
 return {root,name:manifest.name,version:manifest.version,fingerprint:bundleFingerprint(bundle)}
}
