import {spawn,spawnSync} from 'node:child_process'
import {fail,ManagerError} from '../contracts/constants.mjs'
export async function runHostCommand(command,{signal,timeoutMs=120000,maxBytes=262144,onOutput,cooperativeCancel=false,terminationGraceMs=500}={}){
 if(typeof command.executable!=='string'||!Array.isArray(command.args)||command.args.some(a=>typeof a!=='string'||a.includes('\0')))fail('INVALID_COMMAND','无效宿主命令')
 if(/\.(?:cmd|bat)$/i.test(command.executable))fail('CMD_CARRIER_UNVERIFIED','此命令载体尚未通过参数转义验收，请选择已验证的入口')
 if(signal?.aborted)throw new ManagerError('ABORT_ERR','操作已取消')
 return new Promise((resolve,reject)=>{
  let stdout='',stderr='',timedOut=false,forceTimer
  const child=spawn(command.executable,command.args,{cwd:command.cwd,env:{...process.env,...command.envAllowlist},stdio:cooperativeCancel?['ignore','pipe','pipe','ipc']:['ignore','pipe','pipe'],shell:false,detached:process.platform!=='win32',windowsHide:true})
  const force=()=>{try{if(process.platform!=='win32')process.kill(-child.pid,'SIGKILL');else spawnSync('taskkill',['/PID',String(child.pid),'/T','/F'],{stdio:'ignore',windowsHide:true})}catch{}}
  const requestCancel=()=>{if(child.connected)child.send({type:'dsh-depot/cancel'},()=>{})}
  const terminate=()=>{if(cooperativeCancel)requestCancel();else try{if(process.platform!=='win32')process.kill(-child.pid,'SIGTERM');else child.kill()}catch{};forceTimer??=setTimeout(force,terminationGraceMs)}
  if(cooperativeCancel)child.on('message',m=>{if(m?.type==='dsh-depot/ready'&&(signal?.aborted||timedOut))requestCancel()})
  const abort=()=>terminate();signal?.addEventListener('abort',abort,{once:true})
  const timer=setTimeout(()=>{timedOut=true;terminate()},timeoutMs);timer.unref()
  const cleanup=()=>{clearTimeout(timer);clearTimeout(forceTimer);signal?.removeEventListener('abort',abort)}
  for(const [stream,key]of [[child.stdout,'stdout'],[child.stderr,'stderr']])stream.on('data',b=>{const text=b.toString();if(key==='stdout')stdout=(stdout+text).slice(-maxBytes);else stderr=(stderr+text).slice(-maxBytes);onOutput?.(text,key)})
  child.on('error',e=>{cleanup();reject(e)});child.on('close',exitCode=>{cleanup();if(signal?.aborted)reject(new ManagerError('ABORT_ERR','操作已取消'));else resolve({exitCode:timedOut?124:(exitCode??1),stdout,stderr,timedOut})})
 })
}
