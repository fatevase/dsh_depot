# DSH Depot 网站

提供插件浏览、搜索、详情、下载状态和安装指南。使用现有 Svelte 5 + Vite 页面，构建后可静态托管。

在仓库根目录安装依赖后运行 `npm run web:dev` 或 `npm run web:build`；默认输出 `.runtime/web/site/`。没有目录数据时显示真实空状态。

输入为 catalog.json 与 manager-catalog.json；可用 `node web/build.mjs --catalog /path/catalog.json --manager-catalog /path/manager-catalog.json --output .runtime/web/site` 指定。独立构建不读取分发私有状态，不执行插件编译。

五个入口为 index.html、plugins.html、plugin.html、guide.html、manager.html。部署与目录刷新规则见[维护说明](../MAINTAINING.md)。
