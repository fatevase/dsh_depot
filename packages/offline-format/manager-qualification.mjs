const REQUIRED=['network-isolation','cold-install','config-compose','host-page-smoke','authenticated-manager-page','script-install','replace','uninstall','recovery','native-load']
export function qualifyManagerReport(report) {
 const missing=REQUIRED.filter(check=>!report.scope?.includes(check)||report.evidence?.[check]?.status!=='passed')
 return {...report,status:report.status==='failed'?'failed':missing.length?'unverified':'passed',missing}
}

export function isManagerDownload(p) {
 if(!['macos-arm64','linux-x64','win32-x64'].includes(p.target)||!['full','lite','plugin'].includes(p.flavor)||!/^[-a-zA-Z0-9_.]+$/.test(p.fileName??'')||!/^[a-f0-9]{64}$/.test(p.sha256??'')||p.verification?.bundleSha256!==p.sha256)return false
 const match=/^https:\/\/github\.com\/fatevase\/dsh_depot\/releases\/download\/(manager-(?:preview-)?\d+)\/([^/]+)$/.exec(p.packageUrl??'')
 if(!match||match[2]!==p.fileName)return false
 if(p.channel==='preview')return match[1].startsWith('manager-preview-')&&['unverified','failed'].includes(p.verification.status)&&p.verification.validationLevel==='plugin-only'&&/^[a-f0-9]{64}$/.test(p.verification.packageSha256??'')
 return !match[1].startsWith('manager-preview-')&&qualifyManagerReport(p.verification??{}).status==='passed'
}
