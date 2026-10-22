// Read only bounded manifests/entries: never execute discovery candidates or scan dependencies.
import {readFile,realpath,stat,open} from 'node:fs/promises'
import path from 'node:path'
import semver from 'semver'
import managerManifest from '../plugin/package.json' with {type:'json'}
const canonical=async file=>{try{return await realpath(file)}catch{return null}}
export async function desktopResource(resources,name){
 if(name.split('/').some(p=>!p||p==='.'||p==='..'))throw Error('Invalid Desktop resource')
 for(const root of ['app',...(process.versions.electron?['app.asar']:[])])try{return await readFile(path.join(resources,root,name),'utf8')}catch{}
 const file=await open(path.join(resources,'app.asar'),'r')
 try{
  const size=(await file.stat()).size,header=Buffer.alloc(16)
  if((await file.read(header,0,16,0)).bytesRead!==16)throw Error('Truncated ASAR')
  const block=header.readUInt32LE(4),length=header.readUInt32LE(12)
  if(length<2||length>16*1024*1024||block<length+8||block>length+32||block+8>size)throw Error('Invalid ASAR header')
  const buffer=Buffer.alloc(length)
  if((await file.read(buffer,0,length,16)).bytesRead!==length)throw Error('Truncated ASAR header')
  let entry=JSON.parse(buffer)
  for(const part of name.split('/')){entry=entry?.files?.[part];if(entry?.link)throw Error('Linked ASAR entry')}
  const offset=Number(entry?.offset),bytes=entry?.size
  if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(bytes)||bytes<1||bytes>256*1024||block+8+offset+bytes>size||entry.unpacked)throw Error('Invalid ASAR entry')
  const content=Buffer.alloc(bytes)
  if((await file.read(content,0,bytes,block+8+offset)).bytesRead!==bytes)throw Error('Truncated ASAR entry')
  return content.toString('utf8')
 }finally{await file.close()}
}
export async function desktopAt(input,{platform=process.platform}={}){
 let dir=await canonical(input);if(!dir)return null
 if(!(await stat(dir)).isDirectory())dir=path.dirname(dir)
 for(let i=0;i<8;i++){
  for(const candidate of [path.join(dir,'Contents/Resources'),path.join(dir,'resources'),path.basename(dir).toLowerCase()==='resources'?dir:null].filter(Boolean)){
   const resources=await canonical(candidate);if(!resources)continue
   let pkg;try{pkg=JSON.parse(await desktopResource(resources,'package.json'))}catch{continue}
   if(!['dsh-desktop','@deepseek-ai/dsh-desktop'].includes(pkg?.name)||typeof pkg.version!=='string')continue
   const mac=resources.endsWith(path.join('Contents','Resources')),appPath=await canonical(mac?path.resolve(resources,'../..'):path.dirname(resources))
   const native=pkg.name==='@deepseek-ai/dsh-desktop',layout=native?'bundled-cli':'legacy-web'
   const executable=path.join(appPath,mac?`Contents/MacOS/${native?'DeepSeek Harness':'DSH Desktop'}`:platform==='win32'?'DeepSeek Harness.exe':'deepseek-harness')
   const unpacked=await canonical(path.join(resources,'app')),runtimeRoot=path.join(unpacked??path.join(resources,'app.asar'),...(native?['dsh']:[]))
   const cliEntry=native?path.join(runtimeRoot,'node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js'):null
   let dshVersion=pkg.dependencies?.['@deepseek-ai/dsh'],complete=!!await canonical(executable)
   if(native){
    try{const core=JSON.parse(await desktopResource(resources,'dsh/node_modules/@deepseek-ai/dsh/package.json'));if(core.name!=='@deepseek-ai/dsh')throw Error();dshVersion=core.version;await desktopResource(resources,'dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js')}catch{complete=false}
    for(const file of [path.join(resources,'runtime/cli/bin',platform==='win32'?'dsh.cmd':'dsh'),path.join(resources,'runtime/primary-runtime/dependencies/pnpm/bin/pnpm.mjs')])if(!await canonical(file))complete=false
   }
   const compatible=native?semver.valid(dshVersion)&&semver.satisfies(dshVersion,managerManifest.engines.dsh,{includePrerelease:true}):platform==='darwin'&&pkg.version==='0.12.0'&&dshVersion==='0.2.0-rc.2'
   const supported=!!(complete&&compatible)
   return{kind:'official-desktop',layout,appPath,resources,executable,supported,runtimeRoot,cliEntry,profileName:native?'desktop':'web',version:pkg.version,dshVersion,capabilities:{inspect:true,writeSession:false},blockedReason:supported?null:!complete?'DESKTOP_RUNTIME_INCOMPLETE':'DESKTOP_CAPABILITY_UNVERIFIED'}
  }
  const parent=path.dirname(dir);if(parent===dir)break;dir=parent
 }
 return null
}
