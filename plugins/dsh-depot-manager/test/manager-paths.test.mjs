import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import {depotDataHome} from '../core/paths.mjs'
test('persistent toolkit follows each platform data convention and explicit overrides',()=>{const home=path.resolve('/fixture/user');assert.equal(depotDataHome({platform:'darwin',home,env:{}}),path.join(home,'Library/Application Support/DSH Depot'));assert.equal(depotDataHome({platform:'linux',home,env:{XDG_DATA_HOME:path.join(home,'custom')}}),path.join(home,'custom/dsh-depot'));assert.equal(depotDataHome({platform:'win32',home,env:{LOCALAPPDATA:path.join(home,'Local')}}),path.join(home,'Local/DSH Depot'));assert.equal(depotDataHome({platform:'darwin',home,env:{DSH_DEPOT_HOME:path.join(home,'override')}}),path.join(home,'override'))})
