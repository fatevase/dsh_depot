import { spawn, execFileSync } from 'node:child_process'
if (process.argv[2] === '--run') {
  const mode = process.argv[3], command = process.argv.slice(4)
  const identity = command[0] === '--as-user' ? {uid:Number(command[1]),gid:Number(command[2])} : {}
  if(command[0] === '--as-user')command.splice(0,3)
  if (mode === 'loopback') execFileSync('ip', ['link', 'set', 'lo', 'up'])
  const child = spawn(command[0], command.slice(1), { stdio: 'inherit', env: process.env, ...identity })
  child.on('error', error => { console.error(error.message); process.exitCode = 127 }); child.on('exit', code => { process.exitCode = code ?? 1 })
}
