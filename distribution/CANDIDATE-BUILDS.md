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
