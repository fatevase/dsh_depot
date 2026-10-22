export function localized(value,fallback=''){
 if(typeof value==='string')return value
 if(!value||typeof value!=='object')return fallback
 return value['zh-CN']??value['zh-cn']??value.zh??value.default??value.en??Object.values(value).find(v=>typeof v==='string')??fallback
}
export const pluginTitle=item=>localized(item.meta?.title,item.moduleName??item.name)
export const pluginDescription=item=>localized(item.meta?.description,item.description??'')
