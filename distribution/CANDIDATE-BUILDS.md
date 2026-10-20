# 热门候选的 Actions 试编译

`candidate-builds.json` 收录 2026-10-19 筛选出的全部 99 个仓库，与 `plugin-list.json` 的候选仓库 ID 一一对应。每项明确记录仓库、源码分支、打包目录、包名和允许执行的构建脚本；子包和脚本需要在这里维护。

工作流为 **Popular candidate builds (99 plugins)**。配置合并到 main 后自动启动；也可以在 Actions 的 Run workflow 中执行，`batch` 留空运行全部，填 1–20 重试单批；`target` 留空覆盖三个平台。

- 每批 5 个仓库，共 20 批；分别使用 macOS ARM64、Windows x64、Linux x64 的原生 runner，共 60 个批次作业、297 个插件平台任务。最多同时运行 3 个作业。
- 准备阶段核对 GitHub 数字仓库 ID，冻结所有源码 commit。单个仓库发现失败也保留任务和错误结果。
- 每个批次逐项安装构建依赖、执行配置中指定的构建脚本、执行 `npm pack --ignore-scripts`，检查 DSH patch 和声明的 main 是否进入包。没有构建脚本的插件直接试打包现有文件。单个失败后继续处理下一项。
- 有上游锁文件时按锁安装；缺锁时允许本次试编译解析依赖，保存生成的锁及其哈希。这类试编译不提供完整离线依赖保证，生成的锁仍需审核并纳入正式 recipe。
- 构建阶段只有仓库读取权限，checkout 不持久化凭据；上游脚本使用独立 HOME、缓存和环境，不传入 GitHub token。依赖安装和打包关闭生命周期脚本，只显式执行配置允许的构建脚本。
- 每批 artifacts 保留 7 天，包含试编译包、校验和所在的 receipt、依赖锁、分阶段日志。汇总 JSON 和 Markdown 保留 30 天；源码下载校验和、平台、耗时、错误也写入 receipt。
- 汇总作业更新 [Issue #8](https://github.com/fatevase/dsh_depot/issues/8) 的受管区域；单批或单平台重试追加评论，保留全量清单。没有收到的结果记作缺失，不计成功。

这里的“编译打包通过”只证明本轮命令和包文件检查通过。所有结果均标记 `verification: not-run`，不会送入正式 Release 或网站下载目录。完整运行依赖、宿主兼容性、原生模块及断网安装仍由原有 `plugin-distribution.yml` 的人工 recipe 和原版 DSH 验证流程负责。

维护某个失败插件时，先查看对应批次 artifact 中的 `receipt.json` 和日志，调整它的显式构建配置，再单独重试该批和平台。工作流超时、取消或 runner 失败时，汇总标记缺失；可以在 Actions 重跑失败作业。

## 按插件配置构建输入

| 配置 | 行为 |
| --- | --- |
| `source: {mode: "git-tree", paths: [...]}` | 固定 commit，使用 Git 按需获取指定子树，再归档解包；不下载未选中的站点、视频和重复资源。 |
| `outputs: [{path, npmName, kind}]` | 同一源码构建后按组件分别打包；`kind` 为 plugin、library 或 resources。每个包保留自己的名称、版本、依赖和 SHA-256。pnpm 工作区使用 pnpm pack 转换 workspace 依赖。 |
| `sourceDependencies: [{repository, path, commit}]` | 在指定位置准备真实的固定版本源码。`submodule` 可从已冻结父提交读取 Git link SHA；构建不再追踪依赖分支。 |
| `installPaths` | 逐个子项目安装构建依赖，分别保存锁文件；适用于并非 npm workspace 的多包仓库。 |
| `buildDependencies` | 人工补充精确版本的构建依赖，记录适配配置与生成的锁；不修改已安装的 DSH，也不放宽类型检查。 |
| `envPaths` | 显式配置 DSH 构建工具的目录，值必须位于本次源码目录；不会继承本机 DSH_HOME 或凭据。 |
| `assets: [{path, targets}]` | 在构建前下载已核对的原生运行包或资源包。每个平台指定 HTTPS URL、SHA-256、可选的实际 path 与 strip；缺少平台资产直接失败。 |
| `prebuilt: {version, sourceCommit, targets}` | 直接引用上游 tgz，校验摘要、源提交、包名、版本、平台声明、DSH patch 及公开入口；保留原始字节。无需重新编译，也不会标为离线验证通过。 |
| `sourcePatches` | 维护少量显式源码适配：文件原始 SHA-256、适用平台、逐项唯一匹配的文字替换及原因。输入变化即停止，receipt 记录修改前后摘要。 |
| `lockPolicy: "refresh"` | 仅对明确登记的不同步锁允许重新解析；保留原锁摘要和更新后的锁。默认仍按原锁安装。 |

源码中的相对链接只允许指向解包目录内已包含的文件或目录，并复制为普通文件；不创建文件系统符号链接。绝对路径、越界、循环、特殊设备、重复路径、大小写冲突和超限展开仍拒绝。成品包默认继续拒绝链接。下载与摘要计算使用流式处理，普通源码归档上限仍为 512 MiB。

包管理器输出分别保存 stdout 与 stderr；JSON 只读取 stdout，完整合并日志继续保留。pnpm 11 才传入 `pm-on-fail`，旧版沿用自己的命令选项。生命周期脚本在显式构建命令及其子进程中也保持关闭。

### 本次登记的适配

- DSH Web：排除站点和媒体目录，分别打包聚合包与 18 个组件；共享源码参与构建。
- Treg：只获取 dsh 子目录、根说明及许可证，避免为约 32 KB 插件下载完整工具站点源码。
- DSH TUI：准备父提交固定的 dsh-std 子模块，使用 compile 构建 vendor 和客户端；交互验证另行记录。
- dsh-ops：固定 0.4.0-alpha1 对应源码，补齐同版本 SDK，按目标引用该发行版的原生 worker 与 provenance，并检查 staged runtime。
- Openwrite：分别安装根目录、bridge、studio-panel、dsh-dog 的依赖。
- Blender：引用上游 2.5.0 成品，固定源提交与资产摘要。
- Memory Evolve：显式提供文档使用的 esbuild 0.28.1，配置工具解析路径。
- Meow Memory：补充原锁已有的 cordis、timeout 构建依赖。
- OpenCode2DSH：构建 packages/plugin 及客户端，执行上游打包准备步骤，打包实际插件目录。
- Whale Girl：仅 Windows 调整 esbuild 可执行文件定位；Tydora 为两个异常回调补充 unknown 类型。两处均以原文件摘要约束。
- Marketing Dashboard、Reverse Skill：显式允许试编译刷新不同步锁并留存结果。

这些配置表示已实现处理路径，不能代替实际构建结果。失败记录新增 stage、errorCategory、适配配置摘要、源码依赖摘要、每个组件产物及宿主依赖。新的分类会保留在汇总报告中；试编译结果仍不进入正式发布流程。

## 独立公开下载与上游构建依据

- 内部批次只用于调度；网站不再链接需要登录且混装多个插件的 Actions ZIP。`Candidate package downloads` 校验原主分支计划、回执、文件字节和 SHA-256 后，把成功包逐个发布为 prerelease 资源。名称包含仓库 ID、包版本和平台；不会标为已离线验证。
- 该流程会恢复已有完整构建的包，不要求重编译成功项。之后每轮完整候选构建完成会自动发布并刷新 Pages。`candidate-downloads.json` 和 `SHA256SUMS` 记录所有独立文件。
- `packWrapper` 按上游脚本包装打包命令；TUI 使用官方 with-publish-manifest + npm pack。
- `prebuilt.runtimePackages` 固定平台依赖包及资源清单；OpenPencil 将官方平台运行包嵌入对应平台 .tgz，合包前后核对资源摘要。原始输入校验值保留。
- 缺失导出的类型声明只记警告；JS 主入口、DSH patch、平台资源缺失仍阻断。不能将桌面应用空的插件入口当作已完成插件。
- 已逐项核对十个失败项目的 README、构建脚本、CI 和发布元数据。大肥鱼、配置管理器、OpenPencil、iOS、搜番引用明确版本/源码提交/校验值的上游成品；Safety Net 与 Workflow 使用源码提交内已构建的 lib/dist，明确记录未重编译。Tydora 的上游 DSH 入口仍为空骨架，记录真实阻断原因。
- 证据：`docs/evidence/readme-build-adapters-2026-10-20.json`。本轮未新增或在本地运行自动测试。
