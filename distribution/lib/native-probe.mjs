import { readFile, realpath } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
const input = JSON.parse(await readFile(process.argv[2], 'utf8'))
const require = createRequire(path.join(process.env.DSH_HOME, 'profiles/web/node_modules', input.npmName, 'package.json'))
const closure=await realpath(path.join(process.env.DSH_HOME,'profiles/web/node_modules'))
for (const name of input.probes.native ?? []) { const resolved=await realpath(require.resolve(name)); if(!resolved.startsWith(closure+path.sep))throw new Error(`Native dependency resolved outside installed closure: ${name}`); require(name) }
console.log(JSON.stringify({ native: true }))
