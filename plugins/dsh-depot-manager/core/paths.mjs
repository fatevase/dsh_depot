import path from 'node:path'
import os from 'node:os'
export function depotDataHome({platform=process.platform,env=process.env,home=os.homedir()}={}){
 if(env.DSH_DEPOT_HOME)return path.resolve(env.DSH_DEPOT_HOME)
 if(platform==='win32')return path.join(env.LOCALAPPDATA??path.join(home,'AppData','Local'),'DSH Depot')
 if(platform==='darwin')return path.join(home,'Library','Application Support','DSH Depot')
 const base=env.XDG_DATA_HOME&&path.isAbsolute(env.XDG_DATA_HOME)?env.XDG_DATA_HOME:path.join(home,'.local','share')
 return path.join(base,'dsh-depot')
}
