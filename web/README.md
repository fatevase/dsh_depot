# DSH Depot 网站

提供插件浏览、搜索、详情、下载状态和安装指南。使用现有 Svelte 5 + Vite 页面，构建后可静态托管。

在仓库根目录安装依赖后运行 `npm run web:dev` 或 `npm run web:build`；默认输出 `.runtime/web/site/`。没有目录数据时显示真实空状态。

输入为 catalog.json 与 manager-catalog.json；可用 `node web/build.mjs --catalog /path/catalog.json --manager-catalog /path/manager-catalog.json --output .runtime/web/site` 指定。独立构建不读取分发私有状态，不执行插件编译。

五个入口为 index.html、plugins.html、plugin.html、guide.html、manager.html。部署与目录刷新规则见[维护说明](../MAINTAINING.md)。

Pages 部署会将最近一次主分支完整候选构建的汇总合入 catalog.json：candidateBuild 保存批次统计，plugins[].trial 保存各平台状态、原因、文件校验值和 Actions 产物入口。试编译记录不进入正式 packages 下载数组。候选 report 成功（即使部分编译失败）会触发 Pages 更新；部分重试不会覆盖完整快照。
构建汇总经校验后保存在 distribution-state 的 state.json 中。报告 artifact 过期不会移除插件记录；过期的产物链接会隐藏。
