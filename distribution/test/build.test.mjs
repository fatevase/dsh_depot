import test from 'node:test'
import assert from 'node:assert/strict'
import { writeFile, readFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { runCommand, isolatedEnv } from '../lib/process.mjs'
import { extractArchive, buildTask } from '../lib/build.mjs'
import { temporary, recipe, source, host } from './helpers.mjs'
import { resolveTools,prepareTools } from '../lib/process.mjs'
import { buildKey, jsonDigest, fileDigest } from '../lib/model.mjs'
test('process timeout terminates the child and reports seconds rather than milliseconds',async t=>{const dir=await temporary(t);const r=await runCommand({argv:[process.execPath,'-e','setInterval(()=>{},1000)'],cwd:dir,env:await isolatedEnv(dir),timeoutMs:200,logFile:path.join(dir,'log')});assert.equal(r.timedOut,true);assert.notEqual(r.exitCode,0);assert.ok(r.seconds<3,`incorrect seconds: ${r.seconds}`)})
test('build environment does not inherit tokens or user package configuration',async t=>{const dir=await temporary(t);const r=await isolatedEnv(dir,{source:{PATH:process.env.PATH,GITHUB_TOKEN:'secret',NPM_TOKEN:'secret',npm_config_userconfig:'/user/secret'}});assert.equal(r.GITHUB_TOKEN,undefined);assert.equal(r.NPM_TOKEN,undefined);assert.notEqual(r.npm_config_userconfig,'/user/secret');assert.notEqual(r.npm_config_globalconfig,r.npm_config_userconfig)})
test('fixed pnpm invocations explicitly prevent switching to an ancestor package manager',async t=>{
 const dir=await temporary(t)
 for(const [name,version,cli] of [['npm','11.19.1','npm-cli.js'],['pnpm','11.25.0','pnpm.cjs']]){const root=path.join(dir,`${name}-${version}`,'node_modules',name);await mkdir(path.join(root,'bin'),{recursive:true});await writeFile(path.join(root,'package.json'),JSON.stringify({name,version}));await writeFile(path.join(root,'bin',cli),'console.log(JSON.stringify(process.argv.slice(2)))')}
 const tools=await prepareTools({node:process.versions.node,npm:'11.19.1',pnpm:'11.25.0'},dir)
 const r=await runCommand({argv:[...tools.pnpm,'--version'],cwd:dir,env:await isolatedEnv(path.join(dir,'child')),logFile:path.join(dir,'argv.log')})
 assert.deepEqual(JSON.parse(r.output),['--pm-on-fail=ignore','--version'])
})
test('archive traversal is rejected without writing outside the output',async t=>{const dir=await temporary(t);const archive=path.join(dir,'bad.tgz');execFileSync('python3',['-c',"import tarfile,io,sys\nt=tarfile.open(sys.argv[1],'w:gz');i=tarfile.TarInfo('package/../../escaped');i.size=3;t.addfile(i,io.BytesIO(b'bad'));t.close()",archive]);await assert.rejects(extractArchive(archive,path.join(dir,'out')),/Unsafe|escape|archive/i);await assert.rejects(readFile(path.join(dir,'escaped')))})
test('source archive can omit declared development directories while rejecting links elsewhere and traversal even inside exclusions',async t=>{
 const dir=await temporary(t),archive=path.join(dir,'source.tgz')
 const make=name=>execFileSync('python3',['-c',"import tarfile,io,sys\nt=tarfile.open(sys.argv[1],'w:gz');i=tarfile.TarInfo(sys.argv[2]);i.type=tarfile.SYMTYPE;i.linkname='../../outside';t.addfile(i);i=tarfile.TarInfo('source/package.json');i.size=2;t.addfile(i,io.BytesIO(b'{}'));t.close()",archive,name])
 make('source/.agents/skills/dev');await extractArchive(archive,path.join(dir,'allowed'),{exclude:['.agents']});assert.equal(await readFile(path.join(dir,'allowed/package.json'),'utf8'),'{}');await assert.rejects(readFile(path.join(dir,'allowed/.agents/skills/dev')))
 make('source/runtime/link');await assert.rejects(extractArchive(archive,path.join(dir,'denied'),{exclude:['.agents']}),/special member/)
 make('source/.agents/../../outside');await assert.rejects(extractArchive(archive,path.join(dir,'traversal'),{exclude:['.agents']}),/Unsafe archive path/)
})
test('builder resolves relative work directories before passing paths to npm',async t=>{
 const dir=await temporary(t),manifest={name:'dsh-fixture',version:'1.0.0',main:'index.js'}
 const lock=path.join(dir,'runtime.json');await writeFile(lock,JSON.stringify({lockfileVersion:3,packages:{'':{name:'dsh-fixture',version:'1.0.0',dependencies:{}}}}))
 const r=recipe({_root:dir,install:false,buildCommands:[],locks:{runtime:{origin:'adapter',file:'runtime.json',digest:await fileDigest(lock)}}}),s=source({manifestDigest:jsonDigest(manifest),lockDigests:{}})
 const target=`${process.platform}-${process.arch}`,task={recipeId:r.id,source:s,host,target,recipeDigest:jsonDigest(r),buildKey:buildKey({recipe:r,source:s,target,host})}
 const archive=path.join(dir,'source.tgz');execFileSync('python3',['-c',"import tarfile,io,sys,json\nt=tarfile.open(sys.argv[1],'w:gz')\nfor n,v in json.loads(sys.argv[2]).items():\n b=v.encode();i=tarfile.TarInfo(n);i.size=len(b);t.addfile(i,io.BytesIO(b))\nt.close()",archive,JSON.stringify({'source/package.json':JSON.stringify(manifest),'source/index.js':'module.exports=1'})])
 s.archiveSha256=await fileDigest(archive);task.buildKey=buildKey({recipe:r,source:s,target,host})
 const result=await buildTask(task,{recipe:r,sourceArchive:archive,workDir:path.relative(process.cwd(),path.join(dir,'build')),tools:await resolveTools()});assert.equal(result.status,'built',result.error?.message)
})
