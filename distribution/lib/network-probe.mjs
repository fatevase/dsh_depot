import net from 'node:net'
import { writeFile, access } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
export const connect = (host, port) => new Promise(resolve => { const socket = net.connect({ host, port: +port }); const done = result => { socket.destroy(); resolve(result) }; socket.setTimeout(1500); socket.once('connect', () => done(true)); socket.once('error', () => done(false)); socket.once('timeout', () => done(false)) })
if (process.argv[2] === '--child') console.log(JSON.stringify({ connected: await connect(process.argv[3], process.argv[4]) }))
else if (process.argv[2] === '--probe') {
  const externalBlocked = !await connect(process.argv[3], process.argv[4])
  const ipv6Address = `::ffff:${process.argv[3]}`
  const externalBlockedIPv6 = !await connect(ipv6Address, process.argv[4])
  let loopbackAllowed = false, server
  try { server = net.createServer(socket => socket.end()); await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) }); loopbackAllowed = await connect('127.0.0.1', server.address().port) } catch {} finally { if (server?.listening) await new Promise(resolve => server.close(resolve)) }
  let childBlocked = false
  try { const child = await promisify(execFile)(process.execPath, [process.argv[1], '--child', process.argv[3], process.argv[4]], { env: process.env, timeout: 5000 }); childBlocked = !JSON.parse(child.stdout).connected } catch {}
  const child6 = await promisify(execFile)(process.execPath, [process.argv[1], '--child', ipv6Address, process.argv[4]], { env: process.env, timeout: 5000 })
  const childBlockedIPv6 = !JSON.parse(child6.stdout).connected
  let otherProgramBlocked = false
  try { const python = await promisify(execFile)(process.platform === 'win32' ? 'python' : 'python3', ['-c', 'import socket,sys,json\ns=socket.socket();s.settimeout(2)\ntry: s.connect((sys.argv[1],int(sys.argv[2])));print("false")\nexcept OSError: print("true")\nfinally: s.close()', process.argv[3], process.argv[4]], { env: process.env, timeout: 5000 }); otherProgramBlocked = JSON.parse(python.stdout) === true } catch {}
  if (process.argv[5]) {
    const listener = net.createServer(s => s.end()); await new Promise((resolve, reject) => { listener.once('error', reject); listener.listen(0, '127.0.0.1', resolve) });
    await writeFile(process.argv[5], String(listener.address().port));
    for (let i = 0; i < 80; i++) { try { await access(process.argv[5] + '.done'); break } catch {} await delay(100) }
    await new Promise(resolve => listener.close(resolve))
  }
  console.log(JSON.stringify({ externalBlocked, externalBlockedIPv6, childBlockedIPv6, otherProgramBlocked, loopbackAllowed, loopbackBlocked: !loopbackAllowed, childBlocked, controlFamilies: ['IPv4', 'IPv6-mapped-IPv4'] }))
}
