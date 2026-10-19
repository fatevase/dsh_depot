export const LIMITS = Object.freeze({compressedBytes:512*1024*1024,unpackedBytes:2*1024*1024*1024,maxEntries:100000,maxDepth:64,maxItems:20,inspectionConcurrency:2,planTtlMs:15*60*1000,activationTimeoutMs:60000,stagingTtlMs:86400000,recoveryCount:3,recoveryTtlMs:30*86400000})
export class ManagerError extends Error { constructor(code,message,details){super(message);this.name='ManagerError';this.code=code;if(details!==undefined)this.details=details} }
export const fail=(code,message,details)=>{throw new ManagerError(code,message,details)}
