import { cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { argumentsOf } from './cli.mjs'

// Export only the distribution product; never initialize or stage the Workbench checkout.
export async function exportRepository(destination){
 const root=fileURLToPath(new URL('../',import.meta.url)),out=path.resolve(destination)
 if(!out.startsWith(path.join(root,'.runtime')+path.sep))throw Error('Export destination must be inside this workspace .runtime directory')
 await mkdir(out,{recursive:false})
 await cp(path.join(root,'.gitattributes'),path.join(out,'.gitattributes'))
 await cp(path.join(root,'distribution'),path.join(out,'distribution'),{recursive:true,filter:source=>!source.split(path.sep).includes('node_modules')})
 await mkdir(path.join(out,'.github/workflows'),{recursive:true})
 await cp(path.join(root,'.github/workflows/plugin-distribution.yml'),path.join(out,'.github/workflows/plugin-distribution.yml'))
 await cp(path.join(root,'.github/workflows/manager-distribution.yml'),path.join(out,'.github/workflows/manager-distribution.yml'))
 await writeFile(path.join(out,'README.md'),await readFile(path.join(root,'distribution/README.md')))
 await writeFile(path.join(out,'.gitignore'),'node_modules/\n.runtime/\ndist/\n.DS_Store\n')
 await writeFile(path.join(out,'package.json'),JSON.stringify({name:'dsh-depot',version:'0.1.0',private:true,type:'module',scripts:{test:'npm --prefix distribution test','distribution:test':'npm --prefix distribution test'}},null,2)+'\n')
 return out
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=argumentsOf(['export',...process.argv.slice(2)])
 if(!args.output)throw Error('Usage: node distribution/export.mjs --output .runtime/dsh-depot-repository')
 console.log(await exportRepository(args.output))
}
