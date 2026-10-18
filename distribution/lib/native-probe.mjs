import { readFile, realpath } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { within } from './model.mjs'
const input = JSON.parse(await readFile(process.argv[2], 'utf8'))
const require = createRequire(path.join(process.env.DSH_HOME, 'profiles/web/node_modules', input.npmName, 'package.json'))
const closure=await realpath(path.join(process.env.DSH_HOME,'profiles/web/node_modules'))
for (const name of input.probes.native ?? []) { const resolved=await realpath(require.resolve(name)); if(!resolved.startsWith(closure+path.sep))throw new Error(`Native dependency resolved outside installed closure: ${name}`); require(name) }
const packageRoot=path.join(closure,input.npmName)
for(const file of input.probes.skillFiles??[]){const resolved=await realpath(within(packageRoot,file));if(!resolved.startsWith(closure+path.sep))throw Error('Skill file resolved outside installed closure');if(!(await readFile(resolved,'utf8')).trim())throw Error(`Empty bundled skill: ${file}`)}
console.log(JSON.stringify({ native: true }))
