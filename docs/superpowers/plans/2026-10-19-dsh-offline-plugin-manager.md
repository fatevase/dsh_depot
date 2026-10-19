# DSH Offline Plugin Manager Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建可由 Windows、macOS、Linux 脚本离线安装的 DSH 插件管理器，支持拖入成品包或目录、安装、替换、卸载和恢复。

**Architecture:** 薄脚本启动共享 Node 核心，核心通过公开宿主适配器执行受锁保护的操作；Svelte 管理页面只使用受限宿主接口。完整包附带独立 Node，轻量包复用已有 Node。自身维护在退出 DSH 后重跑脚本，不分发独立 GUI 应用。

**Tech Stack:** Node ESM 与 node:test、Svelte `5.57.2`、Vite `8.3.4`、POSIX sh、CMD、可选 Windows PowerShell 5.1。沿用 semver `7.7.2`、yaml `2.9.1`；新增 tar `7.5.22`、构建工具 esbuild `0.28.2`，版本于 2026-10-19 只读核对，实施时写入现有 npm lock。Node 完整包固定 `26.9.0`。

**Spec:** [脚本方案设计](../specs/2026-10-19-dsh-offline-plugin-manager-design.md)。实施者必须先读设计及本计划。本次仅完成文档，尚未安装依赖或创建以下产品文件。

## Global Constraints

- 唯一分发仓库 `fatevase/dsh_depot`；目标仅为 `macos-arm64`、`linux-x64`、`win32-x64`，不增加旧目标别名。
- 先验收 Windows 11 x64、macOS 14+ Apple Silicon、Ubuntu 24.04 x64、Fedora 43 x64；Linux 包含无 DISPLAY 的 SSH 终端路径。
- Windows 入口 `install.cmd`，可选 `install.ps1`；macOS `install.command` 包装 `install.sh`；Linux `install.sh`。
- 完整包携带 Node `26.9.0`；轻量包要求 `^22.19.0 || >=24.0.0`。系统 Node 缺失时不联网补装，不借用私有 Electron 启动机制。
- 首次安装是终端菜单，后续管理页面使用 Svelte。首版没有 Electron/Tauri 安装应用、系统服务、OS 卸载钩子、登录项或自动更新。
- 仅接收成品目录及标准 npm `.tgz`，不拉源码、不在终端用户机器编译、不执行安装脚本；包管理器启用离线和关闭生命周期脚本。
- 明确区分文件完整性、发布来源、运行验证，以及已安装/等待加载/已加载；普通未验证包允许琥珀色明确尝试，首装管理器与脚本本身必须通过验收才提供正式下载。
- 每项压缩输入 ≤512 MiB、展开 ≤2 GiB、条目 ≤100000、层级 ≤64；每批 ≤20 项；静态检查并行度 2，同配置写操作串行。
- 计划预览 15 分钟过期；执行开始后不因预览到期中断；启动 60 秒未见加载回执不当成安装成功或自动回退理由。
- 暂存无引用 24 小时可清理；每配置保留最近 3 个成功恢复点，超过 30 天可清理；未恢复快照不自动清理。
- 不用 sudo、ExecutionPolicy Bypass、自动解安全标记或 shell eval；真实用户的 DSH_HOME、账号与工作区不得用作测试。
- 保留现有网站布局、分类与平台下拉；不自动启动 99 候选构建。普通包名保持短名称，哈希仅写校验记录。
- 本地 Git 无初始提交，不初始化或整体暂存现有工作区。任务的提交步骤仅在已有分发仓库的受控导出分支上执行；只提交任务列明的文件。

## Review Focus

1. 下载目录含中文、空格、`&`、`%`、`!` 或 Unix shell 元字符时，入口必须把它们当路径字面值；Task 6 的真实 shell 测试负责。
2. 已缓存环境恰好能安装残缺包，用户断网空 store 却失败；Task 3、Task 9 必须用新 store 验证，不能借开发缓存过关。
3. 管理器刚完成检查时，另一个窗口改了包、配置或目录链接；Task 4 的执行前指纹校验必须拒绝，不安装旧计划。
4. SSH/无 TTY 或缺 Node 时，不能默选第一套环境、挂死等待或写错机器；Task 5、Task 6 验证菜单与无 DISPLAY/无 stdin 行为。
5. 宿主退出杀死工作进程或恢复期间发生外部修改时，不能宣称后台安装完成或覆盖新状态；Task 4、Task 5 验证持久状态、存活能力及脚本恢复。

## 文件边界与共享契约

代码均位于 `distribution/manager/`；测试加入 `distribution/test/manager-*.test.mjs`，现有 `npm --prefix distribution test` 自动覆盖。测试样本只放 `.runtime/` 或系统临时目录。

| 单元 | 文件 | 对外职责 |
| --- | --- | --- |
| 契约 | `contracts/types.mjs`、`contracts/validate.mjs`、`contracts/constants.mjs` | JSDoc 类型、输入校验、固定限制 |
| 宿主 | `adapters/discover.mjs`、`adapters/cli-web.mjs`、`adapters/official-desktop.mjs`、`adapters/command.mjs`、`adapters/support.json` | 发现、公开命令、版本与能力门禁、写锁边界 |
| 导入 | `core/archive.mjs`、`core/inspect.mjs`、`core/imports.mjs`、`core/package-metadata.mjs` | 安全解包、清单、成品目录、封存与检查 |
| 事务 | `core/plans.mjs`、`core/operations.mjs`、`core/snapshots.mjs`、`core/receipts.mjs`、`core/retention.mjs` | 执行计划、备份、恢复、状态与有限清理 |
| 脚本 | `bootstrap/bootstrap.mjs`、`bootstrap/menu.mjs`、`bootstrap/install.cmd`、`bootstrap/install.ps1`、`bootstrap/install.command`、`bootstrap/install.sh`、`bootstrap/runtime.mjs` | 三平台入口与共享菜单 |
| 工作进程 | `worker/main.mjs`、`worker/channel.mjs`、`worker/handoff.mjs` | 受限任务交接、日志、进程存活与恢复 |
| 宿主插件 | `plugin/host/index.mjs`、`plugin/host/api.mjs`、`plugin/host/upload.mjs`、`plugin/host/activation.mjs`、`plugin/package.json`、`plugin/cordis.patch.yml` | 当前环境、鉴权、传输、页面登记与加载回执 |
| 页面 | `plugin/client/App.svelte`、`ImportPanel.svelte`、`InstalledPanel.svelte`、`OperationsPanel.svelte`、`client.mjs`、`state.mjs`、`styles.css` | DSH 内管理界面与最小宿主 UI 桥 |
| 构建与证据 | `build.mjs`、`build-bootstrap.mjs`、`runtime-lock.json`、`verify.mjs`、`acceptance.mjs` | 独立构建、离线包、Node 归档记录、真实验收 |

Task 1 定义以下 JSDoc 契约，后续任务使用同名字段，禁止临时发明近似类型：

- `HostRecord`：`hostId, kind, version, profileName, profileDir, ownerId, launch, runtime, capabilities, fingerprint`；`runtime` 与安装核心 Node 分开。
- `CommandVector`：`executable, args, cwd, envAllowlist`；`kind` 为直接可执行或经过固定模板处理的 Windows CMD 载体。
- `HostSession`：`host, readState(), apply(action), compose(), readInventory()`，仅在 `HostAdapter.withWriteSession(host, fn)` 回调期间有效；只允许宿主已验证的公共操作。
- `Inspection`：`importId, packageName, version, sha256, target, checks, warnings, blockers, contentRoot`；`contentRoot` 仅宿主可见。
- `Plan`：`planId, hostId, action, packageName, importId, packageSha256, installedFingerprint, hostFingerprint, expiresAt, requiresExit, beforeState, recoveryBytes`，action 仅 install/replace/remove；remove 的 importId/packageSha256 可为 null，必须核对实际安装指纹。
- `Operation`：`operationId, planId, state, eventCursor, snapshotId, result, error`；使用设计状态机的准确状态值。
- `Toolkit`：`version, root, nodePath, nodeFingerprint, flavor, bundleDigest`；flavor 仅 full/lite。

所有异步 API 返回 Promise；失败返回有稳定 `code` 的错误，不让 UI 解析英文日志决定行为。

`Disposer` 为 `() => void | Promise<void>`。每项产物类型由所属任务在 contracts/types.mjs 补齐：不得把未定义的返回类型留给相邻任务猜测。路径表均相对 distribution/manager；测试与现有文件的完整路径以各任务的 distribution 前缀约定为准。

## Task 1 契约和最小测试基础

**Files:** 创建 contracts 三文件、`fixtures/host-cli.mjs`、`fixtures/package.mjs`、`test/manager-contracts.test.mjs`；修改 `distribution/package.json`、`distribution/package-lock.json`。

**Interfaces:** 产生 `validateHost(value): HostRecord`、`validatePlan(value): Plan`、`LIMITS`、`makeFixturePackage(dir, options): Promise<string>`；fixture CLI 只供测试，不作为生产隐藏开关。

- [ ] 写失败测试：`validatePlan({action:'exec'})` 拒绝；未知 schemaVersion 拒绝；三个目标和 `LIMITS.maxEntries===100000`、`maxDepth===64` 精确断言；HostRecord 不能用核心 Node 填宿主运行时。
- [ ] 运行 `node --test distribution/test/manager-contracts.test.mjs`，确认缺实现而失败。
- [ ] 实现契约与 fixture；在 distribution 自有 npm lock 中固定 tar `7.5.22` 和 esbuild `0.28.2`，不改根 pnpm 锁和宿主依赖版本。
- [ ] 用 `npm --prefix distribution ci --ignore-scripts` 及该测试确认通过；检查没有引入 Electron/Tauri 或新的全局工具要求。
- [ ] 在受控分发分支只提交上述文件，提交说明 `feat: define offline manager contracts`。

## Task 2 宿主发现与公开能力门禁

**Files:** 创建 adapters 全部文件、`test/manager-hosts.test.mjs`；创建证据 `docs/evidence/offline-manager-2026-10-19/host-capabilities.json`。

**Interfaces:** 消费 HostRecord；产生 `discoverHosts({platform,env,locations}): HostRecord[]`、`probeHost(candidate): HostRecord`、`adapterFor(host): HostAdapter`、`runHostCommand(command, options): CommandResult`。HostAdapter 的 `withWriteSession(host,fn)` 回调接收 HostSession；`isRunning(host)` 返回布尔值，`launch(host)` 返回受限启动结果。CommandResult 为 `{exitCode,stdout,stderr,timedOut}`；无能力明确返回 blocked code。

- [ ] 写失败测试：同一配置规范路径去重；两份应用不合并；自定义 DSH_HOME 保留；npm CLI 不可写 desktop；ARM 机器上 x64 Host 选 x64；外部目录链接变化使 fingerprint 改变。
- [ ] 运行 `node --test distribution/test/manager-hosts.test.mjs` 确认失败。
- [ ] 实现有限位置发现和公开只读探测；对现有 rc.2 Web 环境核对 operations 的写锁契约，对桌面版记录准确版本、命令来源与退出要求，support.json 只登记实测组合。
- [ ] 运行测试；在临时 DSH_HOME 用真实公开 CLI 核对版本和配置，证据区分真实和模拟。无法取得公共事务边界时标记退出后执行或不支持，不导入私有启动器绕过。
- [ ] 提交 `feat: detect DSH hosts and gate public capabilities`。后续任务不能把未核实桌面能力默认设为 true。

## Task 3 安全导入与包内元数据

**Files:** 创建导入四文件、`test/manager-imports.test.mjs`、`test/manager-metadata.test.mjs`；修改 `distribution/lib/package.mjs`、`distribution/lib/model.mjs`；创建 `test/manager-packaging.test.mjs`。

**Interfaces:** 产生 `inspectArtifact({path,host,trustIndex,limits}): Inspection`、`createImport(context): ImportSession`、`finishImport(id): Inspection`、`writePackageMetadata(root, build): MetadataRecord`；ImportSession 为 `{importId,hostId,ownerId,state,bytes}`，MetadataRecord 为 `{manifest,filesIndex,filesSha256}`。封存后 importId 的字节不可再改。

- [ ] 写失败测试：512 MiB+1、2 GiB+1、100001 条目、65 层和 21 个顶层项均拒绝；归档穿越、内部链接越界、Windows 设备名、大小写碰撞、缺产物源码、缺依赖和宿主 peer 重复打包均有准确 code。
- [ ] 增加冷缓存回归：开发 store 可满足但包内缺运行依赖的 fixture，在新 store 中必须失败；目录重新 pack 的 sha256 变化后不继承原验证标签；只重命名不能命中历史可信哈希。
- [ ] 运行三个测试文件，确认失败；实现 tar 流式受限解析、相对目录上传与权限重建，禁止执行包 JS 或生命周期脚本。
- [ ] 在 npm pack 之前写 depot-manifest.json 与 depot-files.json，清单不自引用；打包后报告绑定最终字节。完整性、来源、运行验证独立返回。
- [ ] 将 model.mjs 的 PACKAGER_VERSION 从当前 `3` 升为 `4`；运行上述测试及 `node --test distribution/test/packaging.test.mjs distribution/test/model.test.mjs`，断言相同 recipe/source 的 buildKey 改变，避免缓存复用旧格式包。不改变 verifier 版本或给旧哈希补写文件。
- [ ] 提交 `feat: inspect and describe portable offline packages`。

## Task 4 计划 事务 备份与恢复

**Files:** 创建事务五文件、`test/manager-transactions.test.mjs`、`test/manager-recovery.test.mjs`。

**Interfaces:** 消费 Inspection 和 HostAdapter；产生 `createOperationPlan({host,inspection,packageName,installedFingerprint,action,now}): Plan`，install/replace 必须提供 inspection，remove 必须提供 packageName/installedFingerprint；以及 `executePlan(plan,{adapter,toolkit,signal,onEvent}): Operation`、`recoverOperation(id,context): Operation`、`readOperation(id): Operation`、`pruneRetention(context,now): CleanupResult`。CleanupResult 为 `{removed,retained,blockedReasons}`；锁内 session 是生成快照、变更和条件恢复的唯一入口。

- [ ] 写失败测试：900 秒后预览到期；重复执行同 planId 幂等；检查后改包、改配置或换目录链接，执行拒绝；执行进行超过 900 秒不中止。
- [ ] 写恢复测试：安装器失败、取消、ENOSPC、进程崩溃各阶段、外部并发变更和备份失效；比对完整依赖图与配置，无关插件和业务数据不变；只备份两个 JSON 不得满足恢复验收。
- [ ] 运行 `node --test distribution/test/manager-transactions.test.mjs distribution/test/manager-recovery.test.mjs` 确认失败。
- [ ] 实现管理器任务锁与宿主写锁的分工、单包事务、逐项批量结果、持久日志和条件恢复；同一锁不重复申请，硬链接不得冒充隔离快照。
- [ ] 通过测试；加入 24 小时暂存、最近 3 个/30 天恢复点、失败点保留、执行前磁盘预估测试；恢复不完整暂停同配置队列。
- [ ] 提交 `feat: transact and recover offline plugin changes`。

## Task 5 共享命令菜单与工作进程

**Files:** 创建 bootstrap.mjs、menu.mjs、runtime.mjs、worker 三文件；创建 `test/manager-cli.test.mjs`、`test/manager-worker.test.mjs`。

**Interfaces:** `main(argv,{io,services}): number` 支持 menu/inspect/install/update/remove/recover/status；`resolveRuntime({bundle,env}): Toolkit`；`handoff(plan,toolkit): Operation`；`workerMain({jobPath,nonce,ownerId}): void`。CLI 使用 core 的 executePlan，不另写一份事务。

- [ ] 写失败测试：无 TTY 且未给已确认 planId，返回 `INPUT_REQUIRED` 且不写配置；缺 Node 返回 `RUNTIME_MISSING`；无 DISPLAY 不触发浏览器/GUI；安装后 60 秒无回执仍为 awaiting_reload。
- [ ] 写工作进程测试：假回执、过期 nonce、错误 owner/hostId 拒绝；退出 Host 后进程被杀时只能恢复或等待脚本，不显示 succeeded；完整/lite 记录不同 Node 与宿主版本。
- [ ] 运行 CLI 与 worker 测试确认失败；实现菜单、参数白名单、稳定工具副本、独立日志和事件游标，不在命令行暴露 token。
- [ ] 更新/卸载管理器必须由外部脚本先确认宿主退出；普通操作仅在适配器存活能力已验证时跨退出自动继续，否则保存任务并返回 `RESUME_FROM_SCRIPT`。
- [ ] 测试通过，并用受控父进程退出实验验证本平台真实存活行为；终端关闭与 Ctrl+C 都核查子进程及恢复记录。
- [ ] 提交 `feat: add shared script menu and durable worker`。

## Task 6 三平台入口与完整轻量分发包

**Files:** 创建四个入口脚本、`build-bootstrap.mjs`、`runtime-lock.json`、`test/manager-bootstrap.test.mjs`、`test/manager-runtime.test.mjs`、`test/manager-bundles.test.mjs`。

**Interfaces:** 消费 Toolkit 与 main；产生 `buildBootstrap({target,flavor,managerArchive,output,runtimeLock}): BundleReceipt`；BundleReceipt 为 `{target,flavor,fileName,path,sha256,compressedBytes,managerSha256,runtimeDigest}`。runtimeLock 记录官方 URL、完整归档 sha256、最终选用文件和许可证，不从文档占位字符串构建产物。

- [ ] 写入口失败测试：真实 cmd/PS/sh 启动 fixture Node，校验空格中文及 `& % ! ^` 等 Windows 可用路径字符、Unix shell 字符不被执行；不启用 delayed expansion、不 use eval、不传 Bypass，wrapper 不能把任意包路径再求值。
- [ ] 写分发测试：Unix 脚本 `0755`/LF、CMD 固定换行；完整包没有系统 Node 也可运行；lite 缺失/过旧/路径失效不写目标；生产包内不需要 node_modules 安装或外网。
- [ ] 运行本平台 `node --test distribution/test/manager-bootstrap.test.mjs distribution/test/manager-runtime.test.mjs distribution/test/manager-bundles.test.mjs`，跨平台项明确 skip 而非算通过。
- [ ] 实现入口：CMD 选择 bundled Node 或固定系统 Node；PS1 可选且不改策略；command/sh 使用 POSIX 引用。执行 bundled Node 之前通过系统哈希工具核对，测试篡改 Node 时其代码从未执行；Windows 固定 Get-FileHash 调用不读取 PS1 代码，不用动态拼接。构建期锁定 Node 26.9.0 官方 win-x64.zip、darwin-arm64.tar.gz、linux-x64.tar.xz，验证官方 SHA256 后写 runtime-lock.json 并附许可证。
- [ ] 以 fixture 管理器包构建三个平台的 full/lite 归档；在对应原生 runner 执行同一测试并核对 ZIP/tar 的实际解压行为与包内哈希。初期 fixture 产物绝不发布。
- [ ] 提交 `feat: ship platform script bootstrap bundles`。

## Task 7 DSH 宿主插件与受限接口

**Files:** 创建 plugin/host 四文件、plugin/package.json、cordis.patch.yml；创建 `test/manager-api.test.mjs`、`test/manager-activation.test.mjs`。

**Interfaces:** `apply(ctx,config): Disposer` 挂载设计 §10 的接口；`currentEnvironment(ctx): HostRecord`；`recordActivation({operationId,nonce,hostId,version}): ActivationReceipt`。ActivationReceipt 为 `{operationId,hostId,managerVersion,loadedAt,nonceDigest}`，不持久化原口令。包名 `dsh-depot-manager`，构建输出只引用宿主 peer，不打包另一份宿主运行库。

- [ ] 写失败测试：请求提供另一个 profileDir 不得改变当前环境；跨用户 importId/operationId、未鉴权上传、伪造回执拒绝；列举插件只含顶层插件与宿主内置标识，不暴露全部依赖为卸载对象。
- [ ] 运行 `node --test distribution/test/manager-api.test.mjs distribution/test/manager-activation.test.mjs` 确认失败。
- [ ] 按 Task 2 已核实公开服务实现 current host、RPC/HTTP 鉴权适配与渐进上传；未具备外部工具时准确返回 capabilities，不暗中下载。
- [ ] 在临时 rc.2 原版配置中挂载，验证配置可合成、服务器鉴权生效、加载回执来自宿主且进程销毁清理登记。
- [ ] 提交 `feat: expose offline manager through DSH public services`。

## Task 8 Svelte 管理页面

**Files:** 创建 client 六类文件；创建 `test/manager-client-state.test.mjs`、`test/manager-client-render.test.mjs`。

**Interfaces:** `createManagerClient(transport)` 提供设计 §10 操作；`reduceManagerState(state,event): State`；`mountManager(container,client): Disposer`。State 为 `{host,imports,installed,operations,selection,connection}`，只包含可展示的序列化字段。最小宿主页面登记桥仅转交容器，主体仍为 Svelte。

- [ ] 写失败测试：状态 reducer 不将 awaiting_reload 显示成 loaded；批量部分失败保留成功项；外部包名与错误 HTML 被转义；只显示当前环境且全局卸载/清空数据入口不存在。
- [ ] 参照现有 web-render.test.mjs 编译真实 Svelte 组件做 SSR 测试，检查五个区域、选择文件/目录替代按钮、文字与颜色双重状态、卸载保留数据提示及需要脚本恢复的文案。
- [ ] 运行这两个测试确认失败；实现导入、预览、列表、进度与有限恢复，避免页面直接拿到 contentRoot 或任意命令入口。
- [ ] 运行测试与真实客户端构建；在原版 DSH 中通过浏览器验证拖包、目录选择、批量、卸载和返回记录，保留截图及关键操作证据。
- [ ] 提交 `feat: add Svelte offline plugin management page`；不改现有站点配色、分类或平台选择。

## Task 9 真实打包与完整闭环

**Files:** 创建 build.mjs、verify.mjs、acceptance.mjs、`test/manager-build.test.mjs`、`test/manager-integration.test.mjs`；修改 plugin/package.json 的已核实 peer 与打包清单。

**Interfaces:** `buildManager({target,output}): PackageReceipt`、`verifyManager({bundle,host,isolation,workDir}): VerificationReport`。PackageReceipt 为 `{name,version,target,path,sha256,compressedBytes,sourceDigest}`；VerificationReport 为 `{status,target,host,packageSha256,bundleSha256,checks,scope,evidence}`，不将模拟测试当真实报告。管理器公开页必须在没有 Better Sidebar 等第三方插件时可用。

- [ ] 写失败测试：打包不包含开发依赖、另一个 Node/Electron UI 或未声明宿主核心包；所有 import/资源可从包内或声明宿主 peer 解析；脚本 bundle 内插件 sha256 与验证包一致。
- [ ] 用 Node tests 运行 build/integration，确认缺少实际构建与导入路径时失败，不用假 HTTP 200 替代加载。
- [ ] 用固定工具链打包 Svelte、纯 JS 核心及 tar 依赖；新增 README 和 LICENSE 随管理器分发。用 Task 6 生成真实管理器 full/lite 安装归档。
- [ ] 在新 DSH_HOME、空 store、OS 级隔离中运行脚本安装管理器，再用页面安装/替换/卸载代表性离线包。纯 JS、小型依赖包、原生模块包和故意残缺包各至少一个；验证原配置中的其他插件仍可用。
- [ ] 运行 `node --test distribution/test/manager-build.test.mjs distribution/test/manager-integration.test.mjs`；真实平台报告必须记录身份、字节、冷缓存、加载回执和恢复证据。缺隔离或缺能力则 unverified，不发布。
- [ ] 提交 `feat: verify the script to DSH offline installation flow`。

## Task 10 CI 与安全发布

**Files:** 创建 `.github/workflows/manager-distribution.yml`、`distribution/manager/ci.mjs`；修改 distribution/export.mjs；创建 `test/manager-workflow.test.mjs`、`test/manager-publication.test.mjs`。

**Interfaces:** `assembleManagerPublication(receipts): PublicationPlan` 返回 `{assets,blocked,verificationRefs}`；`managerCatalogOf(publications,support): ManagerCatalog` 返回 Task 11 的 schema，发布后写 manager-catalog.json。与现有通用插件 receipt 分开 namespace，发布输入列出管理器与 full/lite 各资产。

- [ ] 写失败测试：PR 无发布权限；某平台失败仅阻止该平台资产；首装脚本不能因 allowUnverified=true 绕过验收；导出含 manager 目录与新 workflow，不复制 node_modules/runtime 缓存。
- [ ] 运行 workflow/publication 测试确认失败；配置三平台原生 runner，Fedora/SSH 单独记录操作系统证据，fixture 与真实验证记录不能混入普通下载。
- [ ] 接入已有分发仓库、发布资产校验和、兼容矩阵及时间统计。构建阶段无写凭据，签名/来源记录只作各自真实范围的声明。
- [ ] 运行两测试及现有 `workflow.test.mjs`、`publication.test.mjs`，再人工查看权限与触发条件；只有审阅后的分支工作流才允许正式触发。
- [ ] 提交 `ci: build and qualify script manager distributions`；此任务代码完成不自动授权生产发布或合并。

## Task 11 下载页与三平台指南

**Files:** 创建 distribution/web/ManagerDownload.svelte、manager.html；修改 web/main.js、web/App.svelte、web/Guide.svelte、lib/site.mjs、distribution/README.md、MAINTAINING.md；创建 `test/manager-site.test.mjs`。

**Interfaces:** `manager-catalog.json` 的 schemaVersion=1，按 target/flavor 给 fileName、packageUrl、sha256、compressedBytes、requirements、verification、testedHosts。与普通 catalog 不混写 latest 指针。

- [ ] 写失败测试：没有真实发布资产不显示虚假下载；full 默认、lite 显示 Node 条件；平台路径正确、旧 darwin 目标不进入产品链接；安装指南只在 guide 页面展开。
- [ ] 运行 site 测试确认失败；单独挂载 manager.html 与 SSR 组件测试，保留现有四个入口和布局控件，现有 App 的修改仅为导航及页面路由。
- [ ] 写三平台解压与入口说明、终端菜单、恢复/卸载、SSH 目标提示，不宣传无系统提示双击或通用所有 Linux 支持。
- [ ] 运行 `node --test distribution/test/manager-site.test.mjs distribution/test/site.test.mjs distribution/test/web-render.test.mjs` 并构建全部页面；在浏览器核对导航、下载与指南，保存前后截图以证明原设计保持。
- [ ] 提交 `docs: add script manager downloads and platform guides`。

## Task 12 原生验收与发布审阅

**Files:** 创建 docs/evidence/offline-manager-2026-10-19/acceptance.json、report.html、平台日志与截图；必要的修复只提交对应任务文件，不在本任务扩大产品范围。

**Interfaces:** acceptance.json 对每个 A/P/T/U/R 编号记录 passed/failed/unverified、OS、Host、资产哈希、检查范围、收据、证据路径和实际前置条件，不能仅有全局 true。

- [ ] 对照设计 31 项矩阵逐项执行，A01/A02 必须包含真实下载解压后的双击；Linux 同时覆盖 Ubuntu/Fedora 与无 DISPLAY 交互会话。界面操作不能用文本扫描代替。
- [ ] 断网冷缓存全流程、管理器自身脚本更新/卸载、原生包文件占用、批量部分失败、并发修改、取消、断电模拟、Node 缺失与进程被杀恢复都生成证据。
- [ ] 运行一次 `npm --prefix distribution test`，只对新变化或失败原因补充测试；正常完成后不无理由反复全量执行。
- [ ] 复核 actual target/runtime/ABI、实际首次启动条件、发布字节与证据一致；记录完整/lite 体积、安装与恢复耗时。不能把 runner 绿灯写成所有用户系统都支持。
- [ ] 做最终代码审阅并修复问题，整理受控分发分支及 PR；创建 PR 后附加到当前任务。提交 `test: record cross-platform script installation evidence`。
- [ ] 交付可审阅 PR、报告及构建产物。未经后续明确授权不合并、不发布、不部署 Pages；得到授权后复核最终资产再启动发布并核查链接。

## 设计覆盖与执行交接

| 设计内容 | 所属任务 |
| --- | --- |
| §1–4 脚本架构、目标与包形式 | 1、5、6 |
| §5 宿主身份及运行时 | 2、6 |
| §6 首次安装及加载区别 | 5、6、7、9 |
| §7 页面与交互 | 7、8 |
| §8–9 格式、目录与检查 | 3、9 |
| §10–13 接口、事务、自身维护、保留 | 4、5、7 |
| §14–16 平台、分发及指南 | 6、10、11 |
| §17–20 验收、边界与依据 | 2、9、12 |

建议在当前会话按任务顺序实施，使用 executing-plans；任务间共享接口紧密，先跑通核心与脚本再接页面。用户也可选择 subagent-driven-development，但本计划的编写不启动代理或产品实现。实施前先审阅这份计划并确认执行方式。

本地测试只在独立临时环境运行；Git 提交与 PR 发生于受控分发分支，不把宿主工作台现有未跟踪代码整体纳入初始提交。本轮没有执行本计划中的安装、测试、提交、CI 或发布步骤。


## 2026-10-19 实施状态

已在受控分发分支实现基础代码、三端入口、Svelte 页面与分发门禁。142 项测试通过、1 项 Windows 原生入口在 macOS 跳过；macOS 完成局部真实安装、替换、卸载、系统隔离与宿主验证。完整 31 项与其他原生平台验收仍未完成，整体计划不标记完成。详见 `docs/evidence/offline-manager-2026-10-19/report.html`。本轮未合并、未发布、未部署。
