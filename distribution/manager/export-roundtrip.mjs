import path from 'node:path'
import {mkdir,writeFile,readFile,realpath} from 'node:fs/promises'
import * as tar from 'tar'
import {runtimeTarget} from '../lib/platform.mjs'
import {prepareTools,isolatedEnv} from '../lib/process.mjs'
import {isolationAdapter,startControlServer,checkIsolation,verifyArtifact} from '../lib/verify.mjs'
import {hostEnvironmentDigest} from '../lib/host-environment.mjs'
import {resolveExportSource} from '../../plugins/dsh-depot-manager/core/export-source.mjs'
import {collectExportGraph} from '../../plugins/dsh-depot-manager/core/export-dependencies.mjs'
import {exportInstalledPackage} from '../../plugins/dsh-depot-manager/core/export-package.mjs'
import {atomicJson} from '@dsh-depot/offline-format/files'
export async function createExportFixture(workDir){
 const root=path.join(workDir,'fixture/package')
 async function pkg(dir,name,version,extra={},code='module.exports=1'){await mkdir(dir,{recursive:true});await atomicJson(path.join(dir,'package.json'),{name,version,main:'index.cjs',...extra});await writeFile(path.join(dir,'index.cjs'),code)}
 await pkg(root,'depot-export-fixture','1.0.0',{type:'module',main:'index.js',dsh:{bundle:{patch:'cordis.patch.yml'}},dependencies:{'export-branch':'1.0.0','export-leaf':'1.0.0',alias:'npm:export-real@2.0.0'},bundleDependencies:['export-branch','export-leaf','alias']})
 await writeFile(path.join(root,'index.js'),`import {createRequire} from 'node:module';const require=createRequire(import.meta.url);if(require('export-branch')!==20||require('export-leaf')!==1||require('alias')!==21)throw Error('export runtime closure broken');export const name='depot-export-fixture';export function apply(){}\n`)
 await writeFile(path.join(root,'cordis.patch.yml'),'- insert:\n    - id: depot-export-fixture\n      name: depot-export-fixture\n');await writeFile(path.join(root,'.env'),'EXPORT_TEST_SECRET=not-for-migration')
 await pkg(path.join(root,'node_modules/export-leaf'),'export-leaf','1.0.0',{},'module.exports=1')
 const branch=path.join(root,'node_modules/export-branch');await pkg(branch,'export-branch','1.0.0',{dependencies:{'export-leaf':'2.0.0'},bundleDependencies:['export-leaf']},"module.exports=require('export-leaf')*10")
 await pkg(path.join(branch,'node_modules/export-leaf'),'export-leaf','2.0.0',{},'module.exports=2')
 await pkg(path.join(root,'node_modules/alias'),'export-real','2.0.0',{},'module.exports=21')
 return{root:await realpath(root),name:'depot-export-fixture',version:'1.0.0'}
}
export async function verifyExportRoundTrip({host,workDir,isolation=isolationAdapter(),tools}){
 workDir=path.resolve(workDir);await mkdir(workDir,{recursive:true});let control
 const report={schemaVersion:1,status:'failed',target:runtimeTarget(process.platform,process.arch),sourceInstall:false,sourceConfigurationPreserved:false}
 try{
  tools??=await prepareTools({node:process.versions.node,npm:'11.19.1',pnpm:'11.25.0'},path.join(workDir,'tools'))
  const source=await createExportFixture(workDir),archive=path.join(workDir,'source.tgz');await tar.c({file:archive,gzip:true,cwd:path.dirname(source.root),portable:true},['package'])
  const env=await isolatedEnv(path.join(workDir,'source-environment'),{bin:tools.bin});env.DSH_HOME=path.join(workDir,'source-home');env.npm_config_manage_package_manager_versions='false'
  const profileDir=path.join(env.DSH_HOME,'profiles/web');await mkdir(profileDir,{recursive:true});await writeFile(path.join(profileDir,'pnpm-workspace.yaml'),'packages:\n  - .\nnodeLinker: hoisted\nautoInstallPeers: false\n')
  control=await startControlServer();report.isolationControls=await checkIsolation({adapter:isolation,control,env,workDir});if(report.isolationControls.status!=='passed')throw Error('Source isolation controls failed')
  const install=await isolation.run({mode:'offline',argv:[process.execPath,host.dshBin,'plugin','--profile','web','add',archive,'--offline','--ignore-scripts','--store-dir',path.join(workDir,'source-empty-store')],cwd:workDir,env,timeoutMs:180000,logFile:path.join(workDir,'source-install.log')})
  if(install.exitCode)throw Error(`Source stock DSH install failed: ${install.output.slice(-1000)}`);report.sourceInstall=true
  await writeFile(path.join(profileDir,'local-data.txt'),'SOURCE_PROFILE_PRIVATE_DATA');const manifestBefore=await readFile(path.join(profileDir,'package.json'))
  const runtime={kind:'node',node:process.versions.node,abi:process.versions.modules,napi:+process.versions.napi,platform:process.platform,arch:process.arch,...(process.platform==='linux'?{libc:{name:process.report.getReport().header.glibcVersionRuntime?'glibc':'unknown',version:process.report.getReport().header.glibcVersionRuntime??''}}:{})},exportHost={version:host.version,target:report.target,runtime,dshRoot:host.root,profileDir}
  const bundle={name:source.name,version:source.version,installed:true,enabled:true},selected=await resolveExportSource({host:exportHost,bundle}),started=performance.now()
  const result=await exportInstalledPackage({graph:await collectExportGraph({source:selected,host:exportHost}),host:exportHost,workDir:path.join(workDir,'export')})
  report.exportSeconds=+((performance.now()-started)/1000).toFixed(3);report.artifact={fileName:result.fileName,sha256:result.sha256,compressedBytes:result.compressedBytes};report.sourceConfigurationPreserved=manifestBefore.equals(await readFile(path.join(profileDir,'package.json')))&&(await readFile(path.join(profileDir,'local-data.txt'),'utf8'))==='SOURCE_PROFILE_PRIVATE_DATA'
  const recipe={id:'local-export-roundtrip',npmName:source.name,probes:{registrations:[{id:'depot-export-fixture',name:'depot-export-fixture'}],native:[]}}
  report.verification=await verifyArtifact({task:{buildKey:result.sha256,target:report.target,host:{node:process.versions.node,version:host.version,environmentDigest:hostEnvironmentDigest()}},recipe,artifact:{package:result.path,sha256:result.sha256},host,isolation,workDir:path.join(workDir,'target-verification')})
  if(report.verification.status!=='passed'||!report.sourceConfigurationPreserved)throw Error(report.verification.error?.message??'Target offline migration failed')
  report.status='passed'
 }catch(e){report.error={message:e.message}}finally{await control?.close();await atomicJson(path.join(workDir,'export-roundtrip.json'),report)}
 return report
}
