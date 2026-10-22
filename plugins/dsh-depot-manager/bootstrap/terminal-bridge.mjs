import {spawn} from 'node:child_process'
import {randomUUID} from 'node:crypto'
import {fail} from '../contracts/constants.mjs'
const protocol='dsh-depot-terminal-v1'
const message=(token,value)=>({protocol,token,...value})
const send=(child,value)=>{if(child.connected)child.send(value,()=>{})}

// The original Node console owns input. Electron's GUI executable need not expose a TTY.
export async function runTerminalChild(executable,args,{io,env=process.env,signal}={}){
 if(!io?.isTTY||typeof io.ask!=='function'||typeof io.write!=='function')fail('INPUT_REQUIRED','无交互终端：请明确指定环境和已确认计划')
 if(signal?.aborted)fail('ABORT_ERR','操作已取消')
 const token=randomUUID()
 return new Promise((resolve,reject)=>{
  const child=spawn(executable,args,{shell:false,stdio:['ignore','pipe','pipe','ipc'],env:{...env,DSH_DEPOT_TERMINAL:token}})
  let prompts=Promise.resolve()
  const abort=()=>send(child,message(token,{type:'abort'}))
  signal?.addEventListener('abort',abort,{once:true})
  for(const stream of [child.stdout,child.stderr])stream.on('data',b=>io.write(b.toString()))
  child.on('message',m=>{
   if(m?.protocol!==protocol||m.token!==token)return
   if(m.type==='write'&&typeof m.text==='string')io.write(m.text)
   if(m.type==='ask'&&Number.isSafeInteger(m.id)&&typeof m.prompt==='string'){
    prompts=prompts.then(async()=>{
     if(!child.connected)return
     try{const value=await io.ask(m.prompt);send(child,message(token,{type:'answer',id:m.id,value:String(value)}))}
     catch(e){send(child,message(token,{type:'answer',id:m.id,error:{code:e.code??'INPUT_CLOSED',message:e.message??'终端输入已关闭'}}))}
    }).catch(()=>abort())
   }
  })
  const cleanup=()=>signal?.removeEventListener('abort',abort)
  child.once('error',e=>{cleanup();reject(e)})
  child.once('exit',code=>{cleanup();resolve(code??2)})
 })
}

// An environment flag alone cannot enable interaction: a live IPC channel is required.
export function desktopTerminalIo({onAbort=()=>{}}={}){
 const token=process.env.DSH_DEPOT_TERMINAL
 if(!token||!process.connected||typeof process.send!=='function')return null
 let sequence=0,closed=false;const pending=new Map()
 const rejectAll=()=>{for(const p of pending.values())p.reject(Object.assign(Error('终端连接已关闭'),{code:'INPUT_CLOSED'}));pending.clear()}
 const abort=()=>{onAbort();rejectAll()}
 const receive=m=>{
  if(m?.protocol!==protocol||m.token!==token)return
  if(m.type==='abort'){abort();return}
  if(m.type!=='answer')return
  const p=pending.get(m.id);if(!p)return;pending.delete(m.id)
  if(m.error)p.reject(Object.assign(Error(m.error.message),{code:m.error.code}));else p.resolve(m.value)
 }
 process.on('message',receive);process.once('disconnect',abort)
 return{isTTY:true,
  write:text=>send(process,message(token,{type:'write',text:String(text)})),
  ask:prompt=>new Promise((resolve,reject)=>{
   if(closed||!process.connected){reject(Object.assign(Error('终端连接已关闭'),{code:'INPUT_CLOSED'}));return}
   const id=++sequence;pending.set(id,{resolve,reject});send(process,message(token,{type:'ask',id,prompt}))
  }),
  close(){closed=true;process.removeListener('message',receive);process.removeListener('disconnect',abort);rejectAll();if(process.connected)process.disconnect()}
 }
}
