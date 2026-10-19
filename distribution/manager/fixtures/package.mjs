import {mkdir,writeFile} from 'node:fs/promises'
import path from 'node:path'
import * as tar from 'tar'
export async function makeFixturePackage(dir,{name='dsh-fixture',version='1.0.0',files={},manifest={},archive=true}={}){
 const root=path.join(dir,'package');await mkdir(root,{recursive:true})
 const entries={'package.json':JSON.stringify({name,version,type:'module',main:'lib/index.js',dsh:{manifestVersion:1,bundle:{patch:'./cordis.patch.yml'}},...manifest}),'cordis.patch.yml':'- name: fixture\n  module: '+name+'\n','lib/index.js':'export const name="fixture"; export default function() {}\n',...files}
 for(const [name,data]of Object.entries(entries)){const file=path.join(root,name);await mkdir(path.dirname(file),{recursive:true});await writeFile(file,data)}
 if(!archive)return root
 const output=path.join(dir,'fixture.tgz');await tar.c({gzip:true,file:output,cwd:dir},['package']);return output
}
