// A publisher namespace is not a runtime identity (schemastery is a normal library).
export const isHostPackage=name=>/^@deepseek-ai\/dsh(?:$|-)/.test(name)
export function dependencyIdentity(name,spec){
 const match=/^npm:((?:@[^/]+\/)?[^@]+)@(.+)$/.exec(String(spec))
 return match?{name:match[1],range:match[2],alias:true}:{name,range:spec,alias:false}
}
