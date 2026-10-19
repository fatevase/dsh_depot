import { cp, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { argumentsOf } from './cli.mjs'

// Export only this Depot repository; never initialize or stage the outer Workbench checkout.
export async function exportRepository(destination){
 const root=fileURLToPath(new URL('../',import.meta.url)),out=path.resolve(destination)
 if(!out.startsWith(path.join(root,'.runtime')+path.sep))throw Error('Export destination must be inside this workspace .runtime directory')
  await mkdir(path.dirname(out),{recursive:true})
 await mkdir(out,{recursive:false})
  for(const name of ['.gitattributes','.gitignore','README.md','MAINTAINING.md','package.json','package-lock.json'])await cp(path.join(root,name),path.join(out,name))
  for(const name of ['distribution','web','plugins','packages','.github','docs'])await cp(path.join(root,name),path.join(out,name),{recursive:true,filter:source=>!path.relative(root,source).split(path.sep).some(p=>['node_modules','.runtime','dist','.DS_Store'].includes(p))})
 return out
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=argumentsOf(['export',...process.argv.slice(2)])
 if(!args.output)throw Error('Usage: node distribution/export.mjs --output .runtime/dsh-depot-repository')
 console.log(await exportRepository(args.output))
}
