export function verificationRows(pkg){
 const v=pkg?.verification,checks=v?.checks??{},scope=v?.scope??[]
 const checked=value=>value===true?'passed':value===false?'failed':'missing'
 return [
  {id:'isolation',label:'网络隔离对照',state:checked(v?.isolationControls?.status==='passed'?true:v?.isolationControls?.status==='failed'?false:undefined),description:'检查隔离前可连通，隔离后主进程、子进程及其他程序无法访问外网。'},
  {id:'install',label:'空缓存离线安装',state:checked(checks.install),description:'在独立 DSH 环境与空缓存中，从本地归档安装。'},
  {id:'compose',label:'配置加载',state:checked(checks.compose),description:'检查插件的配置能够被原版 DSH 合成。'},
  {id:'host',label:'宿主启动与页面响应',state:checked(checks.host),description:'检查 DSH 启动后本机页面能够响应。'},
  {id:'registration',label:scope.includes('config-registration')?'技能／配置注册':'客户端模块登记',state:checked(scope.includes('config-registration')?checks.registration:checks.clientModule),description:'检查 recipe 声明的插件入口是否被宿主登记。'},
  ...(scope.includes('bundled-skill-files')?[{id:'skills',label:'随包技能文件',state:checked(checks.native),description:'检查声明的技能文件位于安装依赖闭包中，能够读取且内容非空。'}]:[]),
  {id:'native',label:'原生运行依赖',state:scope.includes('native-load')?checked(checks.native):'not-applicable',description:scope.includes('native-load')?'在隔离环境实际加载 recipe 指定的原生模块。':'没有声明原生加载探针，此项不计为验证通过。'},
  {id:'business',label:'插件完整业务功能',state:'not-covered',description:'尚未覆盖完整浏览器操作、外部 API 和账号授权流程。'}
 ]
}
export const proofLabels={passed:'通过',failed:'失败',missing:'未执行／无记录','not-applicable':'无此探针','not-covered':'未覆盖'}
