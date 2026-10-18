// Shared by static generation and the browser; no Node dependencies.
export const isUnverifiedPackage = p => p?.publicationChannel === 'unverified' && ['unverified','failed'].includes(p.verification?.status) && !!p.verification?.error?.message
export const isDownloadablePackage = p => p?.status === 'published' && (p.verification?.status === 'passed' || isUnverifiedPackage(p))
export function verificationMessage(p){
 if(p?.verification?.error?.message==='Network isolation controls failed')return '网络隔离检查未通过，尚未确认空缓存离线安装、宿主启动及插件加载是否正常。'
 return '安装或运行验证未通过，请查看构建与验证记录中的具体原因。'
}
