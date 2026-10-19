import {stat} from 'node:fs/promises'
import {runHostCommand} from './command.mjs'
import {fail} from '../contracts/constants.mjs'
export function validateOwnership({ownerId,currentId,elevated}){if(elevated||ownerId!==currentId)fail('PROFILE_OWNER_MISMATCH','请使用配置所属的普通用户运行，不要使用 root、sudo 或提升权限');return currentId}
export async function ownershipFacts(profileDir){
 if(process.platform!=='win32')return {ownerId:String((await stat(profileDir)).uid),currentId:String(process.getuid()),elevated:process.geteuid()===0}
 const r=await runHostCommand({executable:'powershell.exe',args:['-NoProfile','-NonInteractive','-Command',"$ErrorActionPreference='Stop'; $i=[Security.Principal.WindowsIdentity]::GetCurrent(); $p=New-Object Security.Principal.WindowsPrincipal($i); $a=Get-Acl -LiteralPath $env:DEPOT_PROFILE_PATH; $o=([Security.Principal.NTAccount]$a.Owner).Translate([Security.Principal.SecurityIdentifier]).Value; @{currentId=$i.User.Value;ownerId=$o;elevated=$p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)} | ConvertTo-Json -Compress"],envAllowlist:{DEPOT_PROFILE_PATH:profileDir},cwd:profileDir},{timeoutMs:10000})
 if(r.exitCode)fail('PROFILE_OWNER_UNVERIFIED','无法核对 Windows 配置所有权');return JSON.parse(r.stdout)
}

export async function assertOwnership(profileDir){return validateOwnership(await ownershipFacts(profileDir))}
