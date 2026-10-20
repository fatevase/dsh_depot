import path from 'node:path'
import {mkdir, stat, writeFile} from 'node:fs/promises'
import {downloadArchive, extractArchive} from './build.mjs'
import {readJson, atomicJson, fileDigest, within} from './model.mjs'
import {isolatedEnv,resolveTools,prepareTools} from './process.mjs'
import {assertArtifact} from './candidate-inputs.mjs'

function platformAllowed(values, value) {
 if (!values?.length) return true
 return !values.includes(`!${value}`) && (values.every(v=>v.startsWith('!'))||values.includes(value)||values.includes('any'))
}
async function inspectPackage(file,directory,{name,version,kind='plugin',warnings=[]}={}) {
 await extractArchive(file,directory)
 const manifest=await readJson(path.join(directory,'package.json'))
 if (typeof manifest.name!=='string'||typeof manifest.version!=='string'||(name&&manifest.name!==name)||(version&&manifest.version!==version)) throw Error('Packed package identity mismatch')
 if (!platformAllowed(manifest.os,process.platform)||!platformAllowed(manifest.cpu,process.arch)) throw Error('Packed package does not support this platform')
 const required=[],runtimeFiles=[]
 if (kind==='plugin') {
  if (typeof manifest.dsh?.bundle?.patch!=='string') throw Error('Packed package is missing its DSH bundle patch')
  required.push(manifest.dsh.bundle.patch);runtimeFiles.push(manifest.dsh.bundle.patch)
 }
 if (manifest.main){required.push(manifest.main);runtimeFiles.push(manifest.main)}
 const exported=value=>{if(typeof value==='string'&&value.startsWith('./')&&!value.includes('*'))required.push(value);else if(value&&typeof value==='object')Object.values(value).forEach(exported)}
 exported(manifest.exports)
 for (const relative of new Set(required)) {
  const target=within(directory,relative)
  try { if(!(await stat(target)).isFile())throw Error('not a regular file') } catch {
   if(!runtimeFiles.includes(relative)&&/\.d\.(ts|mts|cts)$/.test(relative))warnings.push(`类型声明文件缺失：${relative}`)
   else throw Error(`Packed package is missing declared file: ${relative}`)
  }
 }
 for (const value of Object.values({...manifest.dependencies,...manifest.optionalDependencies})) if (/^(?:workspace:|link:|file:)/.test(value)) throw Error('Packed component contains an unresolved local dependency')
 return manifest
}

export async function packCandidate(entry,{sourceDir,workDir,tools,env,run,pnpm}) {
 const output=path.join(workDir,'packages');await mkdir(output,{recursive:true})
 const components=entry.outputs??[{path:entry.packagePath,npmName:entry.npmName,kind:'plugin'}],artifacts=[]
 const names=new Set()
 for (const [index,component] of components.entries()) {
  const directory=within(sourceDir,component.path),manifest=await readJson(path.join(directory,'package.json'))
  if (component.npmName&&manifest.name!==component.npmName) throw Error('Component package identity changed')
  const manager=entry.packManager??(pnpm?'pnpm':'npm')
  if (!tools[manager]) throw Error(`Missing pack tool: ${manager}`)
  const packArgv=[...tools[manager],...(manager==='pnpm'&&env.npm_config_ignore_workspace==='true'?['--ignore-workspace']:[]),'pack',manager==='pnpm'?'--config.ignore-scripts=true':'--ignore-scripts','--json','--pack-destination',output]
  const packed=await run(entry.packWrapper?[...tools.node,within(directory,entry.packWrapper),...packArgv]:packArgv,directory,env,`pack-${index}`)
  const json=JSON.parse(packed.stdout),metadata=Array.isArray(json)?json[0]:json
  if (!metadata?.filename) throw Error('Package manager returned no packed filename')
  const filename=path.basename(metadata.filename)
  if (!filename.endsWith('.tgz')||names.has(filename)) throw Error('Invalid or duplicate component artifact')
  names.add(filename)
  const file=path.join(output,filename),kind=component.kind??'plugin'
  const warnings=[],actual=await inspectPackage(file,path.join(workDir,'packed',String(index)),{name:manifest.name,version:manifest.version,kind,warnings})
  artifacts.push({file,filename,kind,warnings,name:actual.name,version:actual.version,sourcePath:component.path,bytes:(await stat(file)).size,sha256:await fileDigest(file),runtimeDependencies:{...actual.dependencies,...actual.optionalDependencies},hostPeers:actual.peerDependencies??{},hostCompatibility:actual.dsh?.compatibility??null})
 }
 await writeFile(path.join(output,'SHA256SUMS'),artifacts.map(a=>`${a.sha256}  ${a.filename}`).join('\n')+'\n')
 return artifacts
}

export async function importPrebuilt(entry,{workDir,target,tools,run}) {
 const input=entry.prebuilt.targets[target]??entry.prebuilt.targets.all
 if (!input) throw Error(`No prebuilt package for ${target}`)
 assertArtifact(input)
 const output=path.join(workDir,'packages');await mkdir(output,{recursive:true})
 let filename=path.basename(new URL(input.url).pathname)
 if (!filename.endsWith('.tgz')) throw Error('Prebuilt package must be an npm tarball')
 let file=path.join(output,filename)
 await downloadArchive(input.url,file,input)
 const warnings=[],staging=path.join(workDir,'prebuilt'),manifest=await inspectPackage(file,staging,{name:entry.npmName,version:entry.prebuilt.version,warnings})
 const native=entry.prebuilt.runtimePackages?.[target],inputs=[{url:input.url,sha256:input.sha256}]
 if(entry.prebuilt.runtimePackages&&!native)throw Error('Missing pinned native package for target')
 if(native){
  const archive=path.join(workDir,'native.tgz');await downloadArchive(native.url,archive,native)
  const nativeRoot=within(staging,`node_modules/${native.name}`)
  await inspectPackage(archive,nativeRoot,{name:native.name,version:native.version,kind:'resources',warnings})
  if(native.integrityManifest){
   const integrity=await readJson(within(nativeRoot,native.integrityManifest))
   if(integrity.packageName!==native.name||!integrity.files||!Object.keys(integrity.files).length)throw Error('Invalid native integrity manifest')
   for(const [relative,sha]of Object.entries(integrity.files))if(!/^[a-f0-9]{64}$/.test(sha)||await fileDigest(within(nativeRoot,relative))!==sha)throw Error('Native resource integrity mismatch')
  }
  if((manifest.dependencies?.[native.name]??manifest.optionalDependencies?.[native.name])!==native.version)throw Error('Native package differs from upstream dependency')
  for(const [name,version]of Object.entries(manifest.optionalDependencies??{}))if(!name.startsWith(manifest.name+'-')||!/-((darwin|linux|win32)-(arm64|x64))$/.test(name)||version!==native.version)throw Error('Unrelated optional dependencies need an explicit runtime adapter')
  if((manifest.bundleDependencies??manifest.bundledDependencies??[]).length)throw Error('Existing runtime bundles need an explicit merge adapter')
  manifest.optionalDependencies={[native.name]:native.version};manifest.bundleDependencies=[native.name];delete manifest.bundledDependencies
  manifest.os=[process.platform];manifest.cpu=[process.arch];manifest.scripts={};delete manifest.devDependencies
  inputs.push({url:native.url,sha256:native.sha256});await atomicJson(path.join(staging,'package.json'),manifest)
  await atomicJson(path.join(staging,'dsh-depot-inputs.json'),{sourceCommit:entry.commit,target,inputs})
  tools??=process.env.GITHUB_ACTIONS==='true'?await prepareTools({node:'26.9.0',npm:'11.19.1'},path.join(workDir,'tools')):await resolveTools()
  const env=await isolatedEnv(path.join(workDir,'native-pack-env'),{bin:tools.bin})
  const packed=await run([...tools.npm,'pack','--ignore-scripts','--json','--pack-destination',output],staging,env,'pack-prebuilt-runtime')
  const actual=JSON.parse(packed.stdout)[0]
  if(!/^[A-Za-z0-9._+-]+\.tgz$/.test(actual?.filename??''))throw Error('Unexpected repacked native filename')
  filename=actual.filename;file=within(output,filename)
  const checked=path.join(workDir,'native-packed-check')
  await inspectPackage(file,checked,{name:manifest.name,version:manifest.version,warnings})
  const packedNative=within(checked,`node_modules/${native.name}`),integrity=await readJson(within(packedNative,native.integrityManifest))
  for(const [relative,sha]of Object.entries(integrity.files))if(await fileDigest(within(packedNative,relative))!==sha)throw Error('Packed native runtime resource is missing or changed')
 }
 const artifact={file,filename,kind:'plugin',warnings,name:manifest.name,version:manifest.version,bytes:(await stat(file)).size,sha256:await fileDigest(file),url:input.url,inputs,origin:native?'upstream-prebuilt-with-runtime':'upstream-prebuilt',runtimeDependencies:{...manifest.dependencies,...manifest.optionalDependencies},hostPeers:manifest.peerDependencies??{},hostCompatibility:manifest.dsh?.compatibility??null}
 await writeFile(path.join(output,'SHA256SUMS'),`${artifact.sha256}  ${filename}\n`)
 return artifact
}
