import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { jsonDigest } from './model.mjs'
export function hostEnvironmentDigest(directory=fileURLToPath(new URL('../host/',import.meta.url))){
 return jsonDigest(Object.fromEntries(['package.json','pnpm-lock.yaml','pnpm-workspace.yaml'].map(name=>[name,readFileSync(path.join(directory,name),'utf8')])))
}
export const configuredHost = host => ({...host,environmentDigest:hostEnvironmentDigest()})
