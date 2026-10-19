import path from 'node:path'
import {mkdir, stat, writeFile} from 'node:fs/promises'
import {downloadArchive, extractArchive} from './build.mjs'
import {readJson, fileDigest, within} from './model.mjs'
import {assertArtifact} from './candidate-inputs.mjs'

function platformAllowed(values, value) {
 if (!values?.length) return true
 return !values.includes(`!${value}`) && (values.every(v=>v.startsWith('!'))||values.includes(value)||values.includes('any'))
}
async function inspectPackage(file,directory,{name,version,kind='plugin'}={}) {
 await extractArchive(file,directory)
 const manifest=await readJson(path.join(directory,'package.json'))
 if (typeof manifest.name!=='string'||typeof manifest.version!=='string'||(name&&manifest.name!==name)||(version&&manifest.version!==version)) throw Error('Packed package identity mismatch')
 if (!platformAllowed(manifest.os,process.platform)||!platformAllowed(manifest.cpu,process.arch)) throw Error('Packed package does not support this platform')
 const required=[]
 if (kind==='plugin') {
  if (typeof manifest.dsh?.bundle?.patch!=='string') throw Error('Packed package is missing its DSH bundle patch')
  required.push(manifest.dsh.bundle.patch)
 }
 if (manifest.main) required.push(manifest.main)
 const exported=value=>{if(typeof value==='string'&&value.startsWith('./')&&!value.includes('*'))required.push(value);else if(value&&typeof value==='object')Object.values(value).forEach(exported)}
 exported(manifest.exports)
 for (const relative of new Set(required)) {
  const target=within(directory,relative)
  try { if(!(await stat(target)).isFile())throw Error('not a regular file') } catch { throw Error(`Packed package is missing declared file: ${relative}`) }
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
  const packed=await run([...tools[manager],...(manager==='pnpm'&&env.npm_config_ignore_workspace==='true'?['--ignore-workspace']:[]),'pack',manager==='pnpm'?'--config.ignore-scripts=true':'--ignore-scripts','--json','--pack-destination',output],directory,env,`pack-${index}`)
  const json=JSON.parse(packed.stdout),metadata=Array.isArray(json)?json[0]:json
  if (!metadata?.filename) throw Error('Package manager returned no packed filename')
  const filename=path.basename(metadata.filename)
  if (!filename.endsWith('.tgz')||names.has(filename)) throw Error('Invalid or duplicate component artifact')
  names.add(filename)
  const file=path.join(output,filename),kind=component.kind??'plugin'
  const actual=await inspectPackage(file,path.join(workDir,'packed',String(index)),{name:manifest.name,version:manifest.version,kind})
  artifacts.push({file,filename,kind,name:actual.name,version:actual.version,sourcePath:component.path,bytes:(await stat(file)).size,sha256:await fileDigest(file),runtimeDependencies:{...actual.dependencies,...actual.optionalDependencies},hostPeers:actual.peerDependencies??{},hostCompatibility:actual.dsh?.compatibility??null})
 }
 await writeFile(path.join(output,'SHA256SUMS'),artifacts.map(a=>`${a.sha256}  ${a.filename}`).join('\n')+'\n')
 return artifacts
}

export async function importPrebuilt(entry,{workDir,target}) {
 const input=entry.prebuilt.targets[target]??entry.prebuilt.targets.all
 if (!input) throw Error(`No prebuilt package for ${target}`)
 assertArtifact(input)
 const output=path.join(workDir,'packages');await mkdir(output,{recursive:true})
 const filename=path.basename(new URL(input.url).pathname)
 if (!filename.endsWith('.tgz')) throw Error('Prebuilt package must be an npm tarball')
 const file=path.join(output,filename)
 await downloadArchive(input.url,file,input)
 const manifest=await inspectPackage(file,path.join(workDir,'prebuilt'),{name:entry.npmName,version:entry.prebuilt.version})
 const artifact={file,filename,kind:'plugin',name:manifest.name,version:manifest.version,bytes:(await stat(file)).size,sha256:input.sha256,url:input.url,origin:'upstream-prebuilt',runtimeDependencies:{...manifest.dependencies,...manifest.optionalDependencies},hostPeers:manifest.peerDependencies??{},hostCompatibility:manifest.dsh?.compatibility??null}
 await writeFile(path.join(output,'SHA256SUMS'),`${artifact.sha256}  ${filename}\n`)
 return artifact
}
