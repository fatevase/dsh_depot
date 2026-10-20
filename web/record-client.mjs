export async function loadRecord(url,{signal}={}){
 if(typeof url!=='string'||!/^builds\/(?:[0-9]+-[0-9]+\/[0-9]+\/(?:macos-arm64|linux-x64|win32-x64)|packages\/[a-f0-9]{64}|index)\.json$/.test(url))throw Error('构建记录地址无效')
 const response=await fetch(url,{signal,cache:'no-cache'})
 if(!response.ok)throw Error('构建记录暂时无法读取')
 const record=await response.json()
 if(record.schemaVersion!==1)throw Error('构建记录版本不支持')
 return record
}
