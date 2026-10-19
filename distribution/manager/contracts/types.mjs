/** @typedef {{source:'host',kind:'node'|'electron',platform:string,arch:string,node:string,abi?:string,napi?:number,libc?:{name:string,version:string}}} HostRuntime */
/** @typedef {{schemaVersion:1,hostId:string,kind:'cli-web'|'official-desktop',version:string,profileName:string,profileDir:string,ownerId:string,launch:object,runtime:HostRuntime,capabilities:object,fingerprint:string,target?:string}} HostRecord */
/** @typedef {{executable:string,args:string[],cwd:string,envAllowlist:object}} CommandVector */
/** @typedef {{host:HostRecord,readState:Function,apply:Function,compose:Function,readInventory:Function}} HostSession */
/** @typedef {{importId:string,packageName:string,version:string,sha256:string,target:string|null,checks:object,warnings:object[],blockers:object[],contentRoot:string}} Inspection */
/** @typedef {{schemaVersion:1,planId:string,hostId:string,action:'install'|'replace'|'remove',packageName:string,importId:string|null,packageSha256:string|null,installedFingerprint:string|null,hostFingerprint:string,expiresAt:number,requiresExit:boolean,beforeState:object,recoveryBytes:number}} Plan */
/** @typedef {{operationId:string,planId:string,state:string,eventCursor:number,snapshotId:string|null,result:object|null,error:object|null}} Operation */
/** @typedef {{version:string,root:string,nodePath:string,nodeFingerprint:string,flavor:'full'|'lite',bundleDigest:string}} Toolkit */
export {}
