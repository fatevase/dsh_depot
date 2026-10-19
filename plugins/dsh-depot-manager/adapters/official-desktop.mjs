import {fail} from '../contracts/constants.mjs'
export function officialDesktopAdapter(){return{async isRunning(){return true},async launch(host){return host.launch},async withWriteSession(){fail('DESKTOP_CAPABILITY_UNVERIFIED','尚未完成该桌面版本公开写入和恢复验证，请保留原版插件安装入口')}}}
