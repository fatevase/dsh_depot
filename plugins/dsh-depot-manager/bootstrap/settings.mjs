import {readFile} from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import {fail} from '../contracts/constants.mjs'
export async function readDiscoverySettings(root,environment=process.env){
 const file=path.join(root,'settings.json');let config
 try{const source=await readFile(file,'utf8');if(Buffer.byteLength(source)>65536)fail('INVALID_SETTINGS','settings.json 超过大小限制');config=JSON.parse(source.replace(/^\uFEFF/,''))}catch(e){if(e.code==='ENOENT')config={schemaVersion:1};else fail('INVALID_SETTINGS','无法读取 settings.json；请检查 JSON 格式与路径：'+file)}
 if(config?.schemaVersion!==1||Object.keys(config).some(k=>!['schemaVersion','dshHome','dshRoot','hostNode','desktopApp','searchPaths'].includes(k)))fail('INVALID_SETTINGS','settings.json 的字段或版本无效')
 const resolve=value=>{if(typeof value!=='string')fail('INVALID_SETTINGS','settings.json 路径必须是字符串');if(!value)return'';if(value.startsWith('~/'))value=path.join(os.homedir(),value.slice(2));if(!path.isAbsolute(value)||value.includes('\0'))fail('INVALID_SETTINGS','settings.json 请填写完整路径，不要添加 shell 命令');return value}
 const env={...environment}
 for(const [field,name]of Object.entries({dshHome:'DSH_HOME',dshRoot:'DSH_DEPOT_DSH_ROOT',hostNode:'DSH_DEPOT_NODE'})){if(config[field]!==undefined){const value=resolve(config[field]);if(value)env[name]=value}}
 if(config.searchPaths!==undefined&&(!Array.isArray(config.searchPaths)||config.searchPaths.length>32))fail('INVALID_SETTINGS','searchPaths 最多提供 32 个路径')
 let forwarded=[];if(environment.DSH_DEPOT_SEARCH_PATHS){try{forwarded=JSON.parse(environment.DSH_DEPOT_SEARCH_PATHS);if(!Array.isArray(forwarded)||forwarded.length>64)throw Error()}catch{fail('INVALID_SETTINGS','安装器传递的搜索路径无效')}}
 const paths=[...new Set([...forwarded.map(resolve),...(config.searchPaths??[]).map(resolve),...(config.desktopApp!==undefined?[resolve(config.desktopApp)]:[])].filter(Boolean))]
 return{env,paths,file}
}
