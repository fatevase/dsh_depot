// Executable fixture for child-process tests; never loaded by production discovery.
import {writeFile,readFile} from 'node:fs/promises'
if(process.argv.includes('--version'))console.log('0.2.0-rc.2')
else if(process.argv.includes('--dump-config'))console.log('- name: fixture\n  id: fixture')
else if(process.env.FIXTURE_EXIT)process.exitCode=+process.env.FIXTURE_EXIT
else if(process.env.FIXTURE_OUTPUT){await writeFile(process.env.FIXTURE_OUTPUT,JSON.stringify(process.argv.slice(2)));console.log('fixture operation completed')}
else console.log(JSON.stringify({args:process.argv.slice(2)}))
