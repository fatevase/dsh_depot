import { spawn, execFileSync } from 'node:child_process'
import { mkdir, writeFile, readFile, access, realpath, chmod } from 'node:fs/promises'
import path from 'node:path'
export const redact = text => String(text).replace(/([?&]token=)[^\s&"'<>]+/gi, '$1[redacted]').replace(/Bearer\s+[\w.-]+/gi, 'Bearer [redacted]')
export async function isolatedEnv(root, { source = process.env, cache, bin } = {}) {
  const home = path.join(root, 'home'), config = path.join(root, 'config')
  await mkdir(home, { recursive: true }); await mkdir(config, { recursive: true })
  for (const file of ['user.npmrc', 'global.npmrc']) await writeFile(path.join(config, file), '')
  const env = {}
  for (const key of ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'PATHEXT', 'TMPDIR', 'TMP', 'TEMP', 'LANG']) if (source[key]) env[key] = source[key]
  return { ...env, PATH: [bin, source.PATH ?? source.Path].filter(Boolean).join(path.delimiter), HOME: home, USERPROFILE: home, XDG_CACHE_HOME: path.join(home, '.cache'), XDG_CONFIG_HOME: path.join(home, '.config'), npm_config_userconfig: path.join(config, 'user.npmrc'), npm_config_globalconfig: path.join(config, 'global.npmrc'), npm_config_cache: cache ?? path.join(root, 'npm-cache'), npm_config_registry: 'https://registry.npmjs.org', npm_config_audit: 'false', npm_config_fund: 'false', COREPACK_ENABLE_NETWORK: '0', CI: '1', NO_COLOR: '1' }
}
export async function runCommand({ argv, cwd, env, timeoutMs = 600000, logFile }) {
  const started = performance.now(); let output = '', timedOut = false, truncated = false
  await mkdir(path.dirname(logFile), { recursive: true })
  const child = spawn(argv[0], argv.slice(1), { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32', windowsHide: true })
  const stop = () => { try { if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); else process.kill(-child.pid, 'SIGKILL') } catch {} }
  const timer = setTimeout(() => { timedOut = true; stop() }, timeoutMs)
  const collect = chunk => { if (output.length + chunk.length > 32 * 1024 * 1024) { truncated = true; stop(); return } output += chunk.toString() }
  child.stdout.on('data', collect); child.stderr.on('data', collect)
  const exitCode = await new Promise(resolve => { child.once('error', error => { output += error.message; resolve(127) }); child.once('close', code => resolve(code ?? 1)) })
  clearTimeout(timer)
  await writeFile(logFile, redact(output))
  return { exitCode: timedOut || truncated ? 124 : exitCode, timedOut, truncated, seconds: +((performance.now() - started) / 1000).toFixed(3), logFile, output: redact(output) }
}
async function available(file) { try { await access(file); return file } catch { return undefined } }
async function findCli(name) {
  const executableDir = path.dirname(process.execPath)
  const candidates = [process.env[`${name.toUpperCase()}_CLI`], name === 'npm' ? process.env.npm_execpath : undefined, path.join(executableDir, `node_modules/${name}/bin/${name === 'npm' ? 'npm-cli.js' : 'pnpm.cjs'}`), path.resolve(executableDir, `../lib/node_modules/${name}/bin/${name === 'npm' ? 'npm-cli.js' : 'pnpm.cjs'}`)]
  for (const entry of (process.env.PATH ?? '').split(path.delimiter)) for (const suffix of process.platform === 'win32' ? ['.cmd', ''] : ['']) {
    const found = await available(path.join(entry, name + suffix))
    if (found) { const resolved = await realpath(found); if (!resolved.endsWith('.cmd')) candidates.push(resolved); candidates.push(path.join(entry, `node_modules/${name}/bin/${name === 'npm' ? 'npm-cli.js' : 'pnpm.cjs'}`)) }
  }
  for (const file of candidates.filter(Boolean)) if (await available(file)) return file
  throw new Error(`Cannot locate ${name} CLI`)
}
export async function resolveTools() { return { node: [process.execPath], npm: [process.execPath, await findCli('npm')], python: [process.platform === 'win32' ? 'python' : 'python3'] } }
export const commandArgv = (argv, tools) => { if (!tools[argv[0]]) throw new Error(`Tool not configured: ${argv[0]}`); return [...tools[argv[0]], ...argv.slice(1)] }
export async function prepareTools(toolchain, root) {
  if (process.versions.node !== toolchain.node) throw new Error(`Node ${toolchain.node} required, found ${process.versions.node}`)
  const tools = await resolveTools(), env = await isolatedEnv(path.join(root, 'environment'))
  const bin = path.join(root, 'bin'); await mkdir(bin, { recursive: true })
  for (const name of ['npm', 'pnpm']) {
    const version = toolchain[name]; if (!version) continue
    const prefix = path.join(root, `${name}-${version}`), manifest = path.join(prefix, 'node_modules', name, 'package.json')
    let installed; try { installed = JSON.parse(await readFile(manifest, 'utf8')).version } catch {}
    if (installed !== version) {
      const result = await runCommand({ argv: [...tools.npm, 'install', '--prefix', prefix, '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', `${name}@${version}`], cwd: root, env, logFile: path.join(root, `${name}-${version}.log`) })
      if (result.exitCode) throw new Error(`Cannot prepare ${name}@${version}: ${result.output.slice(-1000)}`)
    }
    const cli = path.join(prefix, 'node_modules', name, 'bin', name === 'npm' ? 'npm-cli.js' : 'pnpm.cjs')
    const fixedArgs=name==='pnpm'?['--pm-on-fail=ignore']:[]
    tools[name] = [process.execPath, cli,...fixedArgs]
    const quote = s => `'${s.replaceAll("'", "'\"'\"'")}'`
    if (process.platform === 'win32') await writeFile(path.join(bin, `${name}.cmd`), `@"${process.execPath}" "${cli}" ${fixedArgs.join(' ')} %*\r\n`)
    else { await writeFile(path.join(bin, name), `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(cli)} ${fixedArgs.map(quote).join(' ')} "$@"\n`); await chmod(path.join(bin, name), 0o755) }
  }
  tools.bin = bin; tools.cache = path.join(root, 'npm-cache'); tools.versions = { ...toolchain }; return tools
}
