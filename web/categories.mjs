// Keys remain stable in directory links; labels follow DSH Hub's taxonomy.
export const categories={all:'全部',communication:'通信',development:'开发工具',agents:'智能体',knowledge:'搜索与知识',interface:'界面',memory:'记忆',data:'数据分析',security:'安全',other:'其他'}
const legacy={tools:'development',workspace:'development'}
export function categoryKey(value){
 if(Object.hasOwn(categories,value))return value
 return Object.entries(categories).find(([,label])=>label===value)?.[0]??legacy[value]??'other'
}
export function applyCategories(catalog,candidates=[]){
 const upstream=new Map(candidates.map(p=>[p.repository.toLowerCase(),p]))
 return {...catalog,plugins:catalog.plugins.map(p=>{
  const source=upstream.get(p.repository.toLowerCase())
  const category=categoryKey(source?.upstreamCategory??p.category)
  return {...p,category,...(source?{categorySource:'dsh-hub',upstreamCategory:source.upstreamCategory}:{})}
 })}
}
