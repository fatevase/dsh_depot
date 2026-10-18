import { runtimeTarget } from '../lib/platform.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { packageRuntime } from '../lib/package.mjs'
import { extractArchive } from '../lib/build.mjs'
import { resolveTools } from '../lib/process.mjs'
import { fileDigest } from '../lib/model.mjs'
import { temporary, recipe, source, host } from './helpers.mjs'
test('a real packed plugin bundles its same-source client and preserves peers, license and exports',async t=>{
 const dir=await temporary(t),client=path.join(dir,'client');await mkdir(client)
 await writeFile(path.join(client,'package.json'),JSON.stringify({name:'fixture-client',version:'1.0.0',main:'index.js'}));await writeFile(path.join(client,'index.js'),'module.exports=42')
 const manifest={name:'dsh-fixture',version:'1.0.0',main:'index.js',exports:{'.':'./index.js','./src':'./src.js'},dependencies:{'fixture-client':'^1.0.0'},devDependencies:{'not-for-runtime':'*'},peerDependencies:{'@deepseek-ai/dsh':'^0.2.0-rc.1'},scripts:{postinstall:'exit 99'}}
 const archive=path.join(dir,'input.tgz');const files={'package/package.json':JSON.stringify(manifest),'package/index.js':'module.exports=1','package/src.js':'module.exports=2','package/LICENSE':'MIT'}
 execFileSync('python3',['-c',"import tarfile,io,sys,json\nt=tarfile.open(sys.argv[1],'w:gz')\nfor n,v in json.loads(sys.argv[2]).items():\n b=v.encode();i=tarfile.TarInfo(n);i.size=len(b);t.addfile(i,io.BytesIO(b))\nt.close()",archive,JSON.stringify(files)])
 const lock=path.join(dir,'runtime.json');await writeFile(lock,JSON.stringify({name:'dsh-fixture',version:'1.0.0',lockfileVersion:3,packages:{'':{name:'dsh-fixture',version:'1.0.0',dependencies:{}}}}))
 const r=recipe({_root:dir,locks:{runtime:{origin:'adapter',file:'runtime.json',digest:await fileDigest(lock)}},packageRules:{localPackages:[{path:'client',name:'fixture-client'}]}})
 const task={recipeId:r.id,buildKey:'a'.repeat(64),source:source(),target:runtimeTarget(process.platform,process.arch),host}
 const result=await packageRuntime({task,recipe:r,builtPackage:archive,sourceDir:dir,workDir:path.join(dir,'work'),tools:await resolveTools()})
 assert.equal(result.status,'built');await extractArchive(result.artifacts.package,path.join(dir,'inspect'))
 const output=JSON.parse(await readFile(path.join(dir,'inspect/package.json')))
 assert.equal(output.devDependencies,undefined);assert.deepEqual(output.scripts,{});assert.equal(output.peerDependencies['@deepseek-ai/dsh'],'^0.2.0-rc.1');assert.equal(output.exports['./src'],'./src.js')
 assert.equal(await readFile(path.join(dir,'inspect/LICENSE'),'utf8'),'MIT');assert.equal(await readFile(path.join(dir,'inspect/node_modules/fixture-client/index.js'),'utf8'),'module.exports=42')
 assert.equal(await fileDigest(result.artifacts.package),result.artifacts.sha256)
})
