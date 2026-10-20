import path from 'node:path'
import {mkdir, stat, readFile, writeFile} from 'node:fs/promises'
import semver from 'semver'
import {downloadArchive, extractArchive} from './build.mjs'
import {fileDigest, digest, safeRelative, within} from './model.mjs'
import {isolatedEnv} from './process.mjs'

const repository = value => { if (!/^[\w.-]+\/[\w.-]+$/.test(value ?? '')) throw Error('Invalid source repository'); return value }
const commit = value => { if (!/^[a-f0-9]{40}$/.test(value ?? '')) throw Error('Missing pinned source commit'); return value }
const relative = value => { safeRelative(value); if (value.split('/').some(p=>p.startsWith('-')||/[\r\n*?\[\]]/.test(p))) throw Error('Invalid source path'); return value }
export function assertArtifact(input) {
 const url = new URL(input.url)
 if (url.protocol !== 'https:' || url.username || url.password || !/^[a-f0-9]{64}$/.test(input.sha256 ?? '')) throw Error('Artifact requires HTTPS and an exact SHA-256')
 if (input.maxBytes !== undefined && (!Number.isSafeInteger(input.maxBytes)||input.maxBytes<1||input.maxBytes>2147483648)) throw Error('Invalid artifact size limit')
 if (input.path) relative(input.path)
 if (input.strip !== undefined && (!Number.isSafeInteger(input.strip)||input.strip<0||input.strip>10)) throw Error('Invalid artifact strip count')
 return input
}
export function assertCandidate(entry) {
 repository(entry.repository); relative(entry.packagePath)
 if (entry.source) {
  if (entry.source.mode !== 'git-tree' || !entry.source.paths?.length) throw Error('Invalid component source selection')
  for (const p of entry.source.paths) relative(p)
 }
 for (const dep of entry.sourceDependencies ?? []) {
  repository(dep.repository); relative(dep.path)
  if (dep.submodule) relative(dep.submodule); else commit(dep.commit)
 }
 for (const name of Object.keys(entry.buildDependencies ?? {})) {
  if (!/^(@[\w.-]+\/)?[\w.-]+$/.test(name)||!semver.valid(entry.buildDependencies[name])) throw Error('Build dependencies must use exact package versions')
 }
 for (const p of entry.installPaths ?? []) relative(p)
 if (entry.lockPolicy && !['frozen','refresh'].includes(entry.lockPolicy)) throw Error('Invalid dependency lock policy')
 for (const p of entry.sourceArchiveExcludes ?? []) relative(p)
 for (const patch of entry.sourcePatches ?? []) {
  relative(patch.path)
  if (!/^[a-f0-9]{64}$/.test(patch.sha256??'')||!patch.replacements?.length) throw Error('Source patches require an exact input hash')
  for (const r of patch.replacements) if (typeof r.from!=='string'||!r.from||typeof r.to!=='string') throw Error('Source patches must be literal reviewed replacements')
 }
 for (const [key,p] of Object.entries(entry.envPaths ?? {})) {
  if (!/^DSH_[A-Z0-9_]+$/.test(key)||key==='DSH_HOME') throw Error('Only explicit DSH build paths may be configured')
  relative(p)
 }
 for (const command of entry.buildCommands ?? []) {
  relative(command.cwd ?? '.')
  if (!Array.isArray(command.argv)||!command.argv.length||command.argv.some(a=>typeof a!=='string'||a.includes('\0'))) throw Error('Build commands must be argv arrays')
 }
 for (const output of entry.outputs ?? []) { relative(output.path); if (!['plugin','library','resources'].includes(output.kind??'plugin')) throw Error('Invalid component package kind') }
 for (const asset of entry.assets ?? []) { relative(asset.path); for (const input of Object.values(asset.targets)) assertArtifact(input) }
 if (entry.prebuilt) {
  if (!semver.valid(entry.prebuilt.version)) throw Error('Prebuilt packages require an exact version')
  commit(entry.prebuilt.sourceCommit)
  for (const input of Object.values(entry.prebuilt.targets)) assertArtifact(input)
 }
 return entry
}

// Discovery runs before upstream scripts, where the workflow still has its
// read-only GitHub token. Build workers consume only the frozen Git object IDs.
export async function freezeCandidateInputs(entry, github) {
 assertCandidate(entry)
 if (entry.prebuilt && entry.prebuilt.sourceCommit!==entry.commit) throw Error('Prebuilt source tag moved; review the artifact pin')
 const dependencies=entry.sourceDependencies??[]
 if (dependencies.some(d=>d.submodule)) {
  const tree=(await github.request(`/repos/${entry.repository}/git/trees/${commit(entry.commit)}?recursive=1`)).data
  if (tree.truncated) throw Error('Submodule tree was truncated; explicit source pin required')
  for (const dep of dependencies) if (dep.submodule) {
   const pin=tree.tree.find(e=>e.path===dep.submodule&&e.mode==='160000'&&e.type==='commit')
   if (!pin) throw Error(`Missing source submodule: ${dep.submodule}`)
   dep.commit=commit(pin.sha)
  }
 }
}

export async function acquireSource(input,{workDir,directory,run,exclude=[]}) {
 repository(input.repository); commit(input.commit)
 await mkdir(workDir,{recursive:true})
 const archive=path.join(workDir,'source.tgz')
 let source
 if (input.source?.mode==='git-tree') {
  const gitDir=path.join(workDir,'git'),env=await isolatedEnv(path.join(workDir,'git-environment'))
  Object.assign(env,{GIT_TERMINAL_PROMPT:'0',GIT_CONFIG_NOSYSTEM:'1',GIT_LFS_SKIP_SMUDGE:'1'})
  await mkdir(gitDir,{recursive:true})
  const git=['git','-c','protocol.file.allow=never','-c','core.hooksPath=/dev/null']
  await run([...git,'init'],gitDir,env,'source-init')
  await run([...git,'remote','add','origin',`https://github.com/${input.repository}.git`],gitDir,env,'source-remote')
  await run([...git,'-c','http.version=HTTP/1.1','fetch','--no-tags','--depth=1','--filter=blob:none','origin',input.commit],gitDir,env,'source-fetch')
  const fetched=await run([...git,'rev-parse','FETCH_HEAD'],gitDir,env,'source-identity')
  if (fetched.stdout.trim()!==input.commit) throw Error('Source Git identity changed')
  const paths=input.source.paths.map(relative)
  // No checkout: omitted media blobs are not fetched. The selected Git tree
  // is archived, then processed by the same bounded cross-platform extractor.
  await run([...git,'archive','--format=tar.gz',`--output=${archive}`,'FETCH_HEAD','--',...paths],gitDir,env,'source-components')
  if ((await stat(archive)).size>536870912) throw Error('Selected source components exceed archive limit')
  source={mode:'git-tree',paths}
 } else {
  await downloadArchive(`https://codeload.github.com/${input.repository}/tar.gz/${input.commit}`,archive)
  source={mode:'archive'}
 }
 const sha256=await fileDigest(archive)
 await extractArchive(archive,directory,{strip:source.mode==='git-tree'?0:1,exclude,links:'materialize'})
 return {repository:input.repository,commit:input.commit,sha256,...source}
}

export async function prepareSourceDependencies(entry,{sourceDir,workDir,run}) {
 const records=[]
 for (const [index,dep] of (entry.sourceDependencies??[]).entries()) {
  const directory=within(sourceDir,dep.path)
  const record=await acquireSource(dep,{directory,workDir:path.join(workDir,'source-dependencies',String(index)),run})
  records.push({...record,path:dep.path})
 }
 return records
}

export async function prepareAssets(entry,{sourceDir,workDir,target}) {
 const records=[]
 for (const [index,asset] of (entry.assets??[]).entries()) {
  const input=asset.targets[target]??asset.targets.all
  if (!input) throw Error(`No ${target} asset for ${asset.path}`)
  assertArtifact(input)
  const archive=path.join(workDir,`asset-${index}.archive`)
  await downloadArchive(input.url,archive,input)
  const directory=within(sourceDir,input.path??asset.path)
  await extractArchive(archive,directory,{strip:input.strip??0})
  records.push({path:input.path??asset.path,url:input.url,sha256:input.sha256,target})
 }
 return records
}

export async function applySourcePatches(entry,{sourceDir,target}) {
 const records=[]
 for(const patch of entry.sourcePatches??[]){
  if(patch.targets&&!patch.targets.includes(target))continue
  const file=within(sourceDir,patch.path),before=await readFile(file,'utf8')
  if(digest(before)!==patch.sha256)throw Error(`Source patch input changed: ${patch.path}; review the upstream change`)
  let after=before
  for(const replacement of patch.replacements){
   if(after.split(replacement.from).length!==2)throw Error(`Source patch does not match exactly once: ${patch.path}`)
   after=after.replace(replacement.from,()=>replacement.to)
  }
  await writeFile(file,after)
  records.push({path:patch.path,beforeSha256:patch.sha256,afterSha256:digest(after),reason:patch.reason})
 }
 return records
}
