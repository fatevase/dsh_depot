# 已安装插件导出实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 DSH 管理器中把一个已安装插件及运行依赖导出为可重新导入的离线 `.tgz`，配置留在原机。

**Architecture:** 服务端从当前 DSH 插件身份解析安装根，后台任务收集依赖到独立 staging，使用现有归档和元数据格式打包，并复用导入检查。Svelte 已安装列表只增加导出入口和任务状态，鉴权下载复用 connection 路由。

**Tech Stack:** 现有 JavaScript ESM、Node fs/streams/worker_threads、tar、semver、Svelte、node:test；不新增 npm/pnpm 或其他运行依赖。

**Spec:** [已安装插件导出设计](../specs/2026-10-20-installed-plugin-export-design.md)。状态：已实现、通过三平台原生迁移门禁，0.1.8 测试版已发布；证据见 docs/evidence/installed-plugin-export。

## Global Constraints

- 仅导出程序及运行依赖，配置、密钥文件、业务数据与聊天记录保留原机。
- 首版单插件；不下载、编译、执行安装生命周期脚本，不退出 DSH，不扫描无关插件。
- 保守标记当前平台、宿主版本与原生运行时限制，不声称跨平台或目标环境已验收。
- 保留标准 `package/` 根 `.tgz` 和 schemaVersion=1，名字不带完整哈希。
- 每个 host 最多 1 个执行中导出；预算为 2 GiB 展开、512 MiB 压缩、100000 项、深度 64。
- 任务和下载绑定 host/owner；浏览器不能提交源路径；复用现有鉴权，不新增 yes。
- 只增加已安装行的导出入口和必要任务提示，不重做页面和网站。

## Review Focus

- pnpm 共享 store、相同版本不同 peer 上下文以及嵌套多版本，不能被错误扁平化或跳过。
- workspace/file/npm alias、缺失可选项及依赖环，必须输出可解释的确定结果。
- 非 DSH 核心的 `@deepseek-ai/` 库不能误判为核心；未知共享 peer 不能被随意复制。
- 大包、取消、源文件变化、并发安装和进程退出不能留下 ready 的坏包。
- 配置边界、跨用户下载和过期清理，以及实际原版 DSH 断网导入，必须有独立验证。

## 文件职责

| 文件 | 职责 |
| --- | --- |
| `plugins/dsh-depot-manager/core/export-source.mjs` | 从服务端 bundle 身份和宿主安装上下文定位包根，确认包身份 |
| `plugins/dsh-depot-manager/core/export-dependencies.mjs` | 解析依赖图、peer 分类、版本、预算、排除项和源一致性 |
| `plugins/dsh-depot-manager/core/export-package.mjs` | 复制选择的依赖、生成离线包、写元数据并调用导入检查 |
| `plugins/dsh-depot-manager/core/exports.mjs` | 持久任务、队列、取消、下载租约与清理 |
| `plugins/dsh-depot-manager/worker/export.mjs` | 在独立 worker 执行复制、哈希与打包，阶段进度和中断 |
| `plugins/dsh-depot-manager/plugin/host/export-download.mjs` | 已鉴权 ready 任务的流式下载 |
| `plugins/dsh-depot-manager/plugin/host/api.mjs`、`index.mjs` | RPC、inventory 导出能力及 connection 路由/生命周期 |
| `plugins/dsh-depot-manager/plugin/client/{App,InstalledPanel,ExportsPanel}.svelte`、`client.mjs`、`state.mjs` | 保持当前布局的导出操作与结果 |
| `packages/offline-format/host-packages.mjs`、`package-metadata.mjs` | 明确宿主核心判断和区分源环境/测试证据 |
| `plugins/dsh-depot-manager/core/inspect.mjs` | 与导出规则一致的 alias、host peer 及本机来源检查 |

### Task 1：解析已安装插件与依赖图

**Files:** 新建 export-source.mjs、export-dependencies.mjs、`test/manager-export-dependencies.test.mjs`；新建共享 host-packages.mjs；修改 inspect.mjs 的核心包判断。

**Interfaces:** `resolveExportSource({host, bundle}) → {name, version, root, fingerprint}`；`collectExportGraph({source, host, signal, limits}) → {nodes, edges, rootId, exclusions, warnings, sourceEnvironment}`。内部 node 保存真实路径、包身份和复制预算；公开摘要不返回路径。

- [x] 核对当前 DSH 公开 listBundles 类型与实际返回字段，以真实 fixture 固定取根路径方式；不能臆造 `packageRoot` 字段，不能给浏览器增加任意路径输入。
- [x] 写平铺 npm、pnpm 指向包外 store、多版本、同版本不同 peer 上下文测试；另测不可导出的内置项和可导出的管理器自身。
- [x] 写 workspace/file/npm alias、缺失必需与可选依赖、循环、外部资产链接及普通组织库/DSH 核心分类测试。
- [x] 运行 `node --test plugins/dsh-depot-manager/test/manager-export-dependencies.test.mjs`，确认缺少实现失败。
- [x] 实现按真实安装位置解析与逐边收集；环阻止、未知 host peer 阻止；同步缩小 inspect 对命名空间的过宽判断。
- [x] 运行新增依赖测试和现有导入测试，确认失败原因与兼容行为。
- [x] Commit: `feat(manager): resolve installed plugin export dependency graph`。

### Task 2：生成并检查真正可迁移的归档

**Files:** 新建 export-package.mjs、`test/manager-export-package.test.mjs`；修改 package-metadata.mjs 和 inspect.mjs 的来源显示。

**Interfaces:** `exportInstalledPackage({graph, host, workDir, signal, onProgress}) → {fileName, path, sha256, compressedBytes, inspection, warnings}`；结果 path 仅服务端使用。

- [x] 写测试证明只包含程序和选中依赖，不包含 profile 数据、环境配置、dev-only 依赖和原机链接；源目录哈希保持不变。
- [x] 写实际 tar 解包后的 Node 依赖解析测试，不用“复制函数被调用”代替；测试普通运行 scripts 保留、安装生命周期禁用。
- [x] 写任务累计预算、复制期间源变化、原生 ABI 和源环境非测试证据测试。
- [x] 先运行新测试确认失败，再实现复制、声明归一化、tar 输出和重新生成完整性元数据。元数据接口允许显式空 testedEnvironments，原有 CI 默认行为不变。
- [x] 对最终 `.tgz` 调用 inspectArtifact，实际归档检查通过后才返回可下载结果；外部工具要求保留为迁移限制。
- [x] 运行 `node --test plugins/dsh-depot-manager/test/manager-export-package.test.mjs` 及现有 metadata/imports 测试。
- [x] Commit: `feat(manager): package and inspect locally exported plugins`。

### Task 3：后台导出任务及鉴权下载

**Files:** 新建 exports.mjs、worker/export.mjs、host/export-download.mjs、`test/manager-export-jobs.test.mjs`、`test/manager-export-download.test.mjs`；修改 host/api.mjs、host/index.mjs。

**Interfaces:** `createExport({host, ownerId, packageName, installedFingerprint, storeDir}) → ExportSummary`；`runNextExport(...)`；`cancelExport(...)`；`openExportDownload({exportId, hostId, ownerId, storeDir}) → {stream, fileName, bytes, release}`。RPC 名称按设计稿。

- [x] 写真实后台执行、每 host 单并发、排队、取消、崩溃后失败、ready 后源文件被删除不影响已生成产物的测试。
- [x] 写跨 host/owner 下载拒绝、非 ready 拒绝、stream 内容、下载中租约保护和过期清理测试。
- [x] 先运行测试确认失败，再实现 worker、持久阶段和结果；不得复用安装任务的“已加载”状态表示导出成功。
- [x] 通过现有 connection 认证注册 GET 下载；RPC 只传 exportId/packageName/指纹；dispose 停止 worker 并标记未完成项。
- [x] 将24小时产物清理和最近20条摘要保留放入导出模块，避免影响原有安装恢复点清理。
- [x] 运行新测试及现有 API、worker、retention 回归。
- [x] Commit: `feat(manager): queue exports and stream authenticated downloads`。

### Task 4：接入已安装列表

**Files:** 修改 client/App.svelte、InstalledPanel.svelte、client.mjs、state.mjs；新建 ExportsPanel.svelte；测试扩展现有 client-state/client-render 与 API 测试。

**Interfaces:** Client 增加 `createExport(input)`、`exports()`、`exportStatus(id)`、`cancelExport(id)`；下载地址只由服务器 ready 结果提供。

- [x] 写渲染和交互测试：管理器自身可导出但仍不可自卸载；无源包/内置项给出原因；点击只创建一次任务；取消和下载状态准确。
- [x] 测试导出任务与已有 installed/operations 状态互不覆盖，刷新不使任务消失；未验证本机来源不显示公开验证通过。
- [x] 实现已安装行按钮和复用现有面板样式的任务卡片；不改变整个 Shell、分类、配色或平台名。
- [x] 使用现有管理器预览方式检查空态、运行中、成功及长错误信息；核对窄宽度下按钮和包名不溢出。
- [x] 运行 `npm run manager:test`，以及必要的客户端渲染检查。
- [x] Commit: `feat(manager): expose local plugin export in installed list`。

### Task 5：原版 DSH 迁移闭环与发布

**Files:** 扩展 `distribution/manager/` 原生验收及对应测试、管理器 README 和下载指南；新增 `docs/evidence/installed-plugin-export/` 证据。

- [x] 在三个原生 Actions runner 准备独立源/目标 profile，使用含实际多级运行依赖的测试插件，按标准 DSH 安装、导出、重新导入、目标安装、检查声明注册项的顺序执行。
- [x] 对目标安装断网并使用空缓存，证明不依赖源机 store 或联网解析；仅 `--offline` 和 inspect 成功不能替代网络隔离及安装结果。
- [x] macOS 对已支持 Desktop0.12.0 增加独立配置实测；不修改日常配置，也不宣称其他 Desktop 版本已支持。
- [x] 记录 npm/pnpm 布局、包大小、耗时、检查失败与平台限制；包字节和报告绑定。发布版本在实现完成时依据当前主线递增，不提前指定过期版本号。
- [x] 运行管理器、共享格式、分发管理器和受影响网页测试；请求独立代码复核，处理重要问题后提交 PR。
- [x] 按已有发布授权与三平台门禁发布相同验证字节，更新下载指南；核对线上目录和真实下载链接。
- [x] Commit: `test(manager): verify exported plugins migrate offline through stock DSH`。
