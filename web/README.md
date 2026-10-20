# DSH Depot 网站

提供插件浏览、搜索、详情、下载状态和安装指南。使用现有 Svelte 5 + Vite 页面，构建后可静态托管。

在仓库根目录安装依赖后运行 `npm run web:dev` 或 `npm run web:build`；默认输出 `.runtime/web/site/`。没有目录数据时显示真实空状态。

输入为 catalog.json 与 manager-catalog.json；可用 `node web/build.mjs --catalog /path/catalog.json --manager-catalog /path/manager-catalog.json --output .runtime/web/site` 指定。独立构建不读取分发私有状态，不执行插件编译。

六个入口为 index.html、plugins.html、plugin.html、guide.html、manager.html、builds.html。部署与目录刷新规则见[维护说明](../MAINTAINING.md)。

Pages 部署会将最近一次主分支完整候选构建的汇总合入 catalog.json：candidateBuild 保存批次统计，plugins[].trial 保存各平台状态、下载文件及站内记录地址。试编译记录不进入正式 packages 下载数组。候选 report 成功（即使部分编译失败）会触发 Pages 更新；部分重试不会覆盖完整快照。
构建汇总经校验后保存在 distribution-state 的 state.json 中。报告 artifact 过期不会移除插件记录；过期的产物链接会隐藏。

目录描述直接取 GitHub API 的 repository.description（仓库 About），保留原文；空值显示未填写提示。刷新失败保留有来源的缓存，不回退到手写营销文案。构建包下载采用 candidate-<run>-<attempt> prerelease 的独立 .tgz，不依赖 Actions 附件登录和保留期限。

## 分类与站内构建记录

分类沿用维护清单中的 DSH Hub `upstreamCategory`：通信、开发工具、智能体、搜索与知识、界面、记忆、数据分析、安全、其他。新增清单或调整分类会触发 Pages 刷新；仓库 About 描述不受分类影响。旧的 tools/workspace 筛选地址兼容到开发工具。

- `catalog.json`：目录摘要，候选结果引用 `recordUrl`。
- `builds/index.json`：最近完整批次的平台记录索引，供站内构建列表筛选。
- `builds/<runId>-<attempt>/<repositoryId>/<target>.json`：该批次的平台详情，包含源码提交、步骤命令、退出码、耗时、依赖锁摘要、警告、错误和产物。
- `builds/packages/<buildKey SHA-256>.json`：正式分发包的构建与验证记录，包含实际验证范围。

构建详情和验证组件按需读取 JSON，平台切换会取消旧请求；读取失败提供重试。Actions 仅作原始日志的补充入口。JSON 的构建状态不赋予离线验证通过的含义。原始完整报告缺失时不编造步骤；经校验的汇总持久保存在 distribution-state，Pages 输出独立记录文件。
