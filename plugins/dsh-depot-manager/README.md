# DSH 离线插件管理器

在 DSH 内查看、安装和移除离线插件，支持拖入已构建的 .tgz 或成品目录，卸载默认保留配置和业务数据。

`plugin/` 是装入 DSH 的插件，`core/`、`adapters/`、`worker/` 管理检查与操作，`bootstrap/` 提供终端安装入口。build.mjs 生成已编译的标准插件，build-bootstrap.mjs 将插件与入口放进完整包或轻量包。构建验证与发布编排位于 `distribution/manager/`。

在仓库根目录运行 `npm run manager:test`；`npm run manager:build` 默认构建当前平台轻量包，输出 `.runtime/manager-local/`。平台选项、依赖准备和完整包要求见[维护说明](../../MAINTAINING.md)。

目前适配 DSH 0.2.0-rc.2 Web；Desktop 写入未开放。网站提供三平台完整包和轻量测试包，并显示尚未完成的验收及已知失败。测试版可下载，不代表已通过完整原生验收。

[下载管理器与查看逐步说明](https://fatevase.github.io/dsh_depot/manager.html)

## 找不到安装位置时

安装器检查 PATH 中的 CLI、常见安装位置和当前 DSH 进程；进程只帮助定位，仍需验证包身份与配置归属。自定义目录可在菜单手动输入。

每个安装包附带可编辑的 `settings.json`：`dshHome` 是包含 profiles 的配置主目录，`dshRoot` 是 DSH 包目录，`hostNode` 是目标 DSH 的运行时，`desktopApp` 是桌面应用位置，`searchPaths` 是其他待查路径。留空自动查找，非空字段优先于环境变量。Windows 路径可用正斜杠，如 `D:/Apps/DSH`。不要把 shell 命令粘贴进路径字段。

Windows 用 `install.cmd diagnose`，macOS/Linux 用 `sh install.sh diagnose` 查看只读诊断。完整包的 Node 用于运行安装器，不会自动冒充目标宿主的 Node。当前版本能识别 Desktop，Desktop 安装与恢复仍未接入；填写路径不会取消该能力检查。
