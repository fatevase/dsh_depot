import test from 'node:test'
import assert from 'node:assert/strict'
import { buildKey, assertRecipe, atomicJson, readJson, readRecipes } from '../lib/model.mjs'
import { writeFile } from 'node:fs/promises'
import { recipe, source, host, temporary } from './helpers.mjs'
import path from 'node:path'
test('keys ignore observation time but change on any build input',()=>{
 const r=recipe(),s=source(),input={recipe:r,source:s,target:'darwin-arm64',host}
 const key=buildKey(input);assert.match(key,/^[a-f0-9]{64}$/)
 assert.equal(buildKey({...input,source:{...s,observedAt:'tomorrow'}}),key)
 for(const changed of [{...input,target:'linux-x64'},{...input,source:{...s,commit:'b'.repeat(40)}},{...input,recipe:{...r,locks:{...r.locks,runtime:{digest:'d'.repeat(64)}}}},{...input,recipe:{...r,buildCommands:[['npm','run','other']] }},{...input,host:{...host,node:'24.19.0'}},{...input,verifierVersion:'next'}])assert.notEqual(buildKey(changed),key)
})
test('recipes reject command strings and escaping paths',()=>{
 assert.equal(assertRecipe(recipe()).id,'fixture')
 for(const bad of [recipe({packagePath:'../escape'}),recipe({packagePath:'C:\\escape'}),recipe({buildCommands:['npm run build']}),recipe({repository:'https://evil/repo'}),recipe({id:'../bad'})])assert.throws(()=>assertRecipe(bad))
})
test('atomic JSON writes preserve a readable schema document',async t=>{const dir=await temporary(t);const file=path.join(dir,'nested/state.json');await atomicJson(file,{schemaVersion:1,value:42});assert.deepEqual(await readJson(file),{schemaVersion:1,value:42})})
test('a frozen cohort limits default processing and rejects a source identity mismatch',async t=>{
 const dir=await temporary(t)
 for(const id of ['alpha','beta'])await writeFile(path.join(dir,`${id}.json`),JSON.stringify(recipe({id,repository:`fixture/${id}`,locks:{}})))
 const cohort=[{recipeId:'beta',repository:'fixture/beta'}]
 assert.deepEqual((await readRecipes(dir,{cohort})).map(r=>r.id),['beta'])
 await assert.rejects(readRecipes(dir,{cohort:[{recipeId:'beta',repository:'different/repo'}]}),/Cohort repository mismatch/)
 await assert.rejects(readRecipes(dir,{cohort:[{recipeId:'missing',repository:'fixture/missing'}]}),/Missing cohort recipe/)
})
