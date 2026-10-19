# DSH 离线插件管理器

在 DSH 内查看、安装和移除离线插件，支持拖入已构建的 .tgz 或成品目录，卸载默认保留配置和业务数据。

`plugin/` 是装入 DSH 的插件，`core/`、`adapters/`、`worker/` 管理检查与操作，`bootstrap/` 提供终端安装入口。build.mjs 生成已编译的标准插件，build-bootstrap.mjs 将插件与入口放进完整包或轻量包。构建验证与发布编排位于 `distribution/manager/`。

在仓库根目录运行 `npm run manager:test`；`npm run manager:build` 默认构建当前平台轻量包，输出 `.runtime/manager-local/`。平台选项、依赖准备和完整包要求见[维护说明](../../MAINTAINING.md)。

目前适配 DSH 0.2.0-rc.2 Web；Desktop 写入未开放。网站提供三平台完整包和轻量测试包，并显示尚未完成的验收及已知失败。测试版可下载，不代表已通过完整原生验收。

[下载管理器与查看逐步说明](https://fatevase.github.io/dsh_depot/manager.html)
