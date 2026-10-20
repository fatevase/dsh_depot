import {build} from 'esbuild'
import {mkdtemp,mkdir,cp,writeFile,readFile,rm,stat} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import path from 'node:path'
import os from 'node:os'
import * as tar from 'tar'
import {fileHash,atomicJson} from './core/files.mjs'
import {runHostCommand} from './adapters/command.mjs'
import {fail,MANAGER_VERSION} from './contracts/constants.mjs'
const here=fileURLToPath(new URL('.',import.meta.url))
export async function buildBootstrap({target,flavor,managerArchive,output,runtimeLock,runtimeArchive}={}) {
 if(!['macos-arm64','linux-x64','win32-x64'].includes(target)||!['full','lite'].includes(flavor))fail('INVALID_BUNDLE','平台或安装包类型无效')
 const lock=runtimeLock??JSON.parse(await readFile(path.join(here,'runtime-lock.json'),'utf8'))
 const temp=await mkdtemp(path.join(os.tmpdir(),'depot-bootstrap-')),name=`dsh-depot-manager-${MANAGER_VERSION}-${target}-${flavor}`,root=path.join(temp,name)
 try {
  await mkdir(root);await mkdir(output,{recursive:true})
  await build({entryPoints:[path.join(here,'bootstrap/bootstrap.mjs')],outfile:path.join(root,'core.mjs'),bundle:true,platform:'node',format:'esm',target:'node22',banner:{js:'import {createRequire as __createRequire} from "node:module";const require=__createRequire(import.meta.url);'}})
  const scripts=target==='win32-x64'?['install.cmd','install.ps1']:target==='macos-arm64'?['install.sh','install.command']:['install.sh']
  for(const script of scripts)await cp(path.join(here,'bootstrap',script),path.join(root,script))
  await cp(managerArchive,path.join(root,'manager.tgz'));await cp(path.join(here,'bootstrap/settings.json'),path.join(root,'settings.json'))
  let runtimeDigest=null
  if(flavor==='full') {
   const record=lock.targets[target]
   if(!runtimeArchive)fail('RUNTIME_ARCHIVE_REQUIRED','构建完整包需提供已下载的官方 Node 归档')
   if(await fileHash(runtimeArchive)!==record.sha256)fail('RUNTIME_ARCHIVE_HASH','官方 Node 归档校验失败')
   const extraction=path.join(temp,'runtime-source');await mkdir(extraction)
   const command=target==='win32-x64'?{executable:process.platform==='win32'?'python':'python3',args:['-c','import zipfile,sys;zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])',runtimeArchive,extraction]}:{executable:'tar',args:['-xf',runtimeArchive,'-C',extraction]}
   const result=await runHostCommand({...command,cwd:temp});if(result.exitCode)fail('RUNTIME_EXTRACT_FAILED',result.stderr)
   const runtime=path.join(root,'runtime');await mkdir(runtime)
   const node=path.join(runtime,target==='win32-x64'?'node.exe':'node');await cp(path.join(extraction,record.archiveRoot,record.nodeEntry),node);await cp(path.join(extraction,record.archiveRoot,record.licenseEntry),path.join(runtime,'LICENSE'))
   runtimeDigest=await fileHash(node);await writeFile(path.join(runtime,'node.sha256'),runtimeDigest+'\n')
  }
  const managerSha256=await fileHash(managerArchive),entryHashes=Object.fromEntries(await Promise.all(scripts.map(async name=>[name,await fileHash(path.join(root,name))])))
  await atomicJson(path.join(root,'bundle.json'),{schemaVersion:1,target,flavor,version:MANAGER_VERSION,managerSha256,runtimeDigest,entryHashes,nodeRange:'^22.19.0 || >=24.0.0'})
  await writeFile(path.join(root,'payload.sha256'),(await Promise.all(['core.mjs','manager.tgz','bundle.json'].map(async name=>`${await fileHash(path.join(root,name))}  ${name}`))).join('\n')+'\n')
  const entry=target==='win32-x64'?'双击 install.cmd':target==='macos-arm64'?'打开 install.command；也可在终端运行 sh install.sh':'在终端运行 sh install.sh（支持 SSH）'
  await writeFile(path.join(root,'README.txt'),[
   `DSH 离线插件管理器 ${MANAGER_VERSION}`,'',
   '更新安装器：重新下载并完整解压新版；旧的解压目录和维护入口不会自动更新。',
   '使用前：已安装并初始化 DSH 0.2.0-rc.2 Web，或 macOS DSH Desktop 0.12.0。运行中的 DSH 也可安装，完成后请重启 DSH。',
   '1. 将整个压缩包解压到本机可写目录；不要在压缩包预览窗口中运行。',
   `2. ${entry}。`,
   '3. 找到唯一的受支持 Desktop 后会自动使用应用自带 DSH，并进入五项菜单；选择“1. 安装 / 替换离线成品包”即可安装随包管理器，不再输入 yes。只有多个目标无法确定时才要求选择。',
   '4. 查看显示的目标和阶段提示。无需事先退出 DSH，安装完成后按提示重启。旧的待处理任务可选择第 3 项继续。',
   '5. 从 DSH 中的“离线插件”进入管理页。只有宿主实际加载后才算启用成功。','',
   flavor==='full'?'本包附带独立 Node 用于启动安装助手，无需另外安装 Node 或编译工具；插件安装复用目标 DSH 的包管理入口。':'这是轻量包，需要已有 Node ^22.19.0 或 >=24；未准备 Node 时请使用完整包。',
   'core.mjs 是安装助手；runtime 是附带运行时；manager.tgz 是插件成品。安装器不附带或替换 pnpm，Desktop 使用应用自带的 pnpm 和安装包装；CLI 使用目标 DSH 原本的解析方式。',
   '请保留所有文件。安装过程不联网下载依赖，不执行编译，不需要管理员权限或 sudo。',
   '后续通常在 DSH 的“离线插件”页面导入其他成品。也可运行 install.cmd menu --file "D:/plugins/plugin.tgz" 或 sh install.sh menu --file "/path/plugin.tgz"，再选择第 1 项安装指定包。',
   '安装直接调用对应 DSH，不扫描或备份整个已安装依赖目录，不会自动完整回滚。失败时查看任务与日志，修正后重装成品或先前版本；旧版已创建的恢复点仍可恢复。卸载默认保留业务数据。',
   '自动查找会检查 PATH、常见安装位置与运行进程；仍找不到时，在菜单选择“手动指定安装或配置路径”。',
   '也可用文本编辑器修改同目录 settings.json：dshHome=配置主目录（包含 profiles），dshRoot=DSH 包目录（包含 package.json），hostNode=目标 DSH 的 Node，desktopApp=桌面版应用路径，searchPaths=其他完整路径数组。空字符串表示自动查找。',
   'Windows 的 JSON 路径请使用 C:/Users/name/... 或双反斜杠；路径不是命令，不要粘贴 DSH_HOME=... 这样的 shell 表达式。settings.json 非空字段优先于环境变量。',
   '命令行诊断：Windows 运行 install.cmd diagnose；macOS/Linux 运行 sh install.sh diagnose。诊断不修改 DSH。',
   '设置只改变查找位置，不会绕过宿主能力检查。Desktop 当前适配 macOS 0.12.0；其他版本不开放写入。常规安装无需退出；恢复旧版完整恢复点时仍需先退出 DSH。',''
  ].join('\n'))
  const fileName=name+(target==='win32-x64'?'.zip':'.tgz'),archive=path.join(output,fileName)
  if(target==='win32-x64'){
   const result=await runHostCommand({executable:process.platform==='win32'?'python':'python3',args:['-c',"import pathlib,sys,zipfile\nroot=pathlib.Path(sys.argv[1])\nwith zipfile.ZipFile(sys.argv[2],'w',zipfile.ZIP_DEFLATED) as z:\n for file in sorted(root.rglob('*')):\n  if file.is_file():z.write(file,file.relative_to(root.parent))",root,archive],cwd:temp})
   if(result.exitCode)fail('BUNDLE_ARCHIVE_FAILED',result.stderr)
  }else await tar.c({file:archive,gzip:true,cwd:temp,portable:true},[name])
  return{version:MANAGER_VERSION,target,flavor,fileName,path:archive,sha256:await fileHash(archive),compressedBytes:(await stat(archive)).size,managerSha256,runtimeDigest}
 }finally{await rm(temp,{recursive:true,force:true})}
}
