// The user explicitly selected pure-offline operation. Trust the loaded lockfile
// for this operation only; never depend on a second snapshot being present.
// pnpm still verifies archive bytes, resolves new entries offline, and rejects
// missing dependencies. No global config or installation metadata is changed.
export function offlinePolicyArgs(){return ["--config.trust-lockfile=true"]}
export const offlinePolicyNotice="纯离线策略：信任现有锁定结果，不复审仓库元数据；保留包完整性校验和禁止安装脚本。\n"
