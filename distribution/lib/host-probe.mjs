import { spawn, execFileSync } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { redact } from './process.mjs'
const input = JSON.parse(await readFile(process.argv[2], 'utf8'))
let logs = '', ended = false
const command = [...(input.hostPrefix ?? []), process.execPath]
const child = spawn(command[0], [...command.slice(1), '--expose-internals', input.dshBin, '--profile', 'web', '--no-open', '--host', '127.0.0.1', '--port', '0'], { env: process.env, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' })
child.on('exit', () => { ended = true }); child.on('error', error => { logs += error.message; ended = true })
child.stdout.on('data', data => { logs += data }); child.stderr.on('data', data => { logs += data })
const result = { host: false, clientModule: false, native: false }
try {
  let url; const deadline = Date.now() + (input.startupTimeoutMs ?? 60000)
  while (Date.now() < deadline && !ended) { url = logs.match(/dsh web:\s*(http:\/\/127\.0\.0\.1:\d+\/[^\s]*)/)?.[1]; if (url) break; await delay(100) }
  if (!url) throw new Error('Host did not become ready')
  let response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(5000) })
  if (response.status === 303) { const cookie = response.headers.get('set-cookie')?.split(';')[0]; if (!cookie) throw new Error('Missing authentication cookie'); const destination = new URL(response.headers.get('location') ?? '/', url); if (destination.origin !== new URL(url).origin) throw new Error('Unexpected auth redirect'); response = await fetch(destination, { headers: { Cookie: cookie }, redirect: 'manual', signal: AbortSignal.timeout(5000) }) }
  const html = await response.text(); result.httpStatus = response.status
  result.host = response.status === 200 && html.includes('<html') && !/failed to (?:import|apply|initialize)|unhandled rejection|TypeError:|ReferenceError:|ERR_MODULE_NOT_FOUND|Cannot find (?:module|package)/i.test(logs)
  result.clientModule = input.probes.clientModule ? html.includes(input.probes.clientModule) : null
  result.native = true
} catch (error) { result.error = error.message }
finally { try { if (process.platform === 'win32') execFileSync('taskkill',['/PID',String(child.pid),'/T','/F'],{stdio:'ignore'}); else process.kill(-child.pid,'SIGTERM') } catch {}; for (let i = 0; i < 30 && !ended; i++) await delay(100); if (!ended) { try { process.kill(-child.pid,'SIGKILL') } catch {} }; await writeFile(input.logFile, redact(logs)) }
console.log(JSON.stringify(result))
if (!result.host || (input.probes.clientModule && !result.clientModule) || !result.native) process.exitCode = 1
