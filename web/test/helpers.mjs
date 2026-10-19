import {mkdtemp,rm} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
export async function temporary(t){const dir=await mkdtemp(path.join(os.tmpdir(),'depot-test-'));t.after(()=>rm(dir,{recursive:true,force:true}));return dir}
