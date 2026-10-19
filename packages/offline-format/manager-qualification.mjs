const REQUIRED=['network-isolation','cold-install','config-compose','host-page-smoke','authenticated-manager-page','script-install','replace','uninstall','recovery','native-load']
export function qualifyManagerReport(report) {
 const missing=REQUIRED.filter(check=>!report.scope?.includes(check)||report.evidence?.[check]?.status!=='passed')
 return {...report,status:report.status==='failed'?'failed':missing.length?'unverified':'passed',missing}
}
