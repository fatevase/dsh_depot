import path from 'node:path'
import { mkdir, copyFile, readdir } from 'node:fs/promises'
import { atomicJson, readJson, within } from './model.mjs'
export async function writeReceipt(file, receipt){
 const result=structuredClone(receipt),base=path.dirname(path.resolve(file)),dest=path.join(base,'assets',receipt.buildKey);await mkdir(dest,{recursive:true})
 for(const kind of ['package','provenance','dependencies','checksums'])if(receipt.artifacts?.[kind]){const target=path.join(dest,path.basename(receipt.artifacts[kind]));if(path.resolve(receipt.artifacts[kind])!==target)await copyFile(receipt.artifacts[kind],target);result.artifacts[kind]=path.relative(base,target).split(path.sep).join('/')}
 await atomicJson(file,result);return result
}
export async function loadReceipt(file){const r=await readJson(file);for(const kind of ['package','provenance','dependencies','checksums'])if(r.artifacts?.[kind])r.artifacts[kind]=within(path.dirname(path.resolve(file)),r.artifacts[kind]);return r}
export async function receiptFiles(dir){const files=[];for(const e of await readdir(dir,{withFileTypes:true})){const f=path.join(dir,e.name);if(e.isDirectory())files.push(...await receiptFiles(f));else if(e.name==='receipt.json')files.push(f)}return files}
