import {readFile,lstat} from 'node:fs/promises'
import path from 'node:path'
import {auditTree,atomicJson,readJson,fileHash,digest} from './files.mjs'
import {fail} from './constants.mjs'
const excluded=['depot-files.json','depot-manifest.json']
export async function writePackageMetadata(root,{task,recipe}){
 const p=await readJson(path.join(root,'package.json')),filesIndex=await auditTree(root,{exclude:excluded});await atomicJson(path.join(root,'depot-files.json'),filesIndex)
 const filesSha256=await fileHash(path.join(root,'depot-files.json'))
 const nativePresent=filesIndex.some(f=>/\.(?:node|dll|dylib|so)$/.test(f.path))||!!recipe.probes?.native?.length
 const manifest={schemaVersion:1,package:{name:p.name,version:p.version,recipeId:recipe.id},target:task.target,compatibility:{dshRange:recipe.hostRange??task.host.version,nodeRange:p.engines?.node??task.host.node,hostPeers:p.peerDependencies??{},testedEnvironments:[task.host]},native:{present:nativePresent,...(recipe.nativeConstraints??{})},source:task.source,build:{buildKey:task.buildKey,recipeDigest:task.recipeDigest??null,packagerVersion:'4'},filesSha256}
 await atomicJson(path.join(root,'depot-manifest.json'),manifest);return{manifest,filesIndex,filesSha256}
}
export async function verifyPackageMetadata(root){
 const file=path.join(root,'depot-manifest.json');let manifest;try{manifest=await readJson(file)}catch(e){if(e.code==='ENOENT')return null;throw e}
 if(manifest.schemaVersion!==1)fail('UNSUPPORTED_SCHEMA','不支持的包清单协议')
 if(await fileHash(path.join(root,'depot-files.json'))!==manifest.filesSha256)fail('INTEGRITY_MISMATCH','文件清单摘要不一致')
 const index=await readJson(path.join(root,'depot-files.json')),actual=await auditTree(root,{exclude:excluded})
 if(!Array.isArray(index)||JSON.stringify(index)!==JSON.stringify(actual))fail('INTEGRITY_MISMATCH','包负载与清单不一致')
 const p=await readJson(path.join(root,'package.json'));if(p.name!==manifest.package?.name||p.version!==manifest.package?.version)fail('IDENTITY_MISMATCH','包身份与清单不一致')
 return manifest
}
