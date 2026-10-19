import {fail} from '../contracts/constants.mjs'
export async function choose(io,title,items) {
 if(!items.length)fail('NO_CHOICES','未找到可操作的项目；请确认已有 DSH 安装和已初始化的配置')
 if(!io.isTTY)fail('INPUT_REQUIRED','无交互终端：请明确指定环境和已确认计划')
 io.write(title+'\n'+items.map((x,i)=>`${i+1}. ${x.label}`).join('\n')+'\n')
 const answer=await io.ask('请选择编号（q 退出）：')
 if(answer==='q')return null
 const index=Number(answer)-1
 if(!Number.isInteger(index)||index<0||index>=items.length)fail('INPUT_REQUIRED','选择无效')
 return items[index].value
}
