export const LIMITS = Object.freeze({compressedBytes:512*1024*1024,unpackedBytes:2*1024*1024*1024,maxEntries:100000,maxDepth:64,maxItems:20,inspectionConcurrency:2,planTtlMs:15*60*1000,activationTimeoutMs:60000,stagingTtlMs:86400000,recoveryCount:3,recoveryTtlMs:30*86400000})
export const MANAGER_NAME='dsh-depot-manager'
export const MANAGER_VERSION='0.1.0'
export const CORE_NODE_RANGE='^22.19.0 || >=24.0.0'
export const STATES=Object.freeze(['inspecting','blocked','ready','queued','waiting_for_host_exit','backing_up','applying','checking_install','awaiting_reload','succeeded','recovering','failed_restored','recovery_required','cancelled'])
export class ManagerError extends Error { constructor(code,message,details){super(message);this.name='ManagerError';this.code=code;if(details!==undefined)this.details=details} }
export const fail=(code,message,details)=>{throw new ManagerError(code,message,details)}
