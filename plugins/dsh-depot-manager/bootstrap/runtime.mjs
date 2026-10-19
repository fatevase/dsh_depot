import {access,realpath} from 'node:fs/promises'
import path from 'node:path'
import {fileHash} from '../core/files.mjs'
import {runHostCommand} from '../adapters/command.mjs'
import {fail,CORE_NODE_RANGE,MANAGER_VERSION} from '../contracts/constants.mjs'
import semver from 'semver'
export async function resolveRuntime({bundle,env=process.env,nodePath}={}) {
  let selected=nodePath
  if (!selected && bundle.flavor==='full') selected=path.join(bundle.root,'runtime',process.platform==='win32'?'node.exe':'node')
  if (!selected) {
    for (const dir of (env.PATH??'').split(path.delimiter).filter(Boolean)) {
      const candidate=path.join(dir,process.platform==='win32'?'node.exe':'node')
      try {await access(candidate);selected=candidate;break} catch {}
    }
  }
  if (!selected) fail('RUNTIME_MISSING',`请安装 Node ${CORE_NODE_RANGE}，或使用完整包`)
  const resolved=await realpath(selected).catch(()=>fail('RUNTIME_MISSING','Node 路径无效'))
  const nodeFingerprint=await fileHash(resolved)
  if(bundle.flavor==='full' && nodeFingerprint!==bundle.runtimeDigest) fail('RUNTIME_HASH_MISMATCH','附带 Node 校验失败')
  const result=await runHostCommand({executable:resolved,args:['--version'],cwd:bundle.root},{timeoutMs:10000})
  if(result.exitCode || !semver.satisfies(result.stdout.trim().replace(/^v/,''),CORE_NODE_RANGE)) fail('RUNTIME_UNSUPPORTED',`需要 Node ${CORE_NODE_RANGE}`)
  return {version:MANAGER_VERSION,root:bundle.root,nodePath:resolved,nodeVersion:result.stdout.trim(),nodeFingerprint,flavor:bundle.flavor,bundleDigest:bundle.bundleDigest??null}
}
