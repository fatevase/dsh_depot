# DSH 离线插件管理器

在 DSH 内查看、安装和移除离线插件，支持拖入已构建的 .tgz 或成品目录，卸载默认保留配置和业务数据。

`plugin/` 是装入 DSH 的插件，`core/`、`adapters/`、`worker/` 管理检查与操作，`bootstrap/` 提供终端安装入口。build.mjs 生成已编译的标准插件，build-bootstrap.mjs 将插件与入口放进完整包或轻量包。构建验证与发布编排位于 `distribution/manager/`。

在仓库根目录运行 `npm run manager:test`；`npm run manager:build` 默认构建当前平台轻量包，输出 `.runtime/manager-local/`。平台选项、依赖准备和完整包要求见[维护说明](../../MAINTAINING.md)。

目前适配 DSH 0.2.0-rc.2 Web，以及 macOS DSH Desktop 0.12.0（使用应用自带 DSH 和 Electron）。网站提供三平台完整包和轻量测试包，并显示尚未完成的验收及已知失败。测试版可下载，不代表已通过完整原生验收。

[下载管理器与查看逐步说明](https://fatevase.github.io/dsh_depot/manager.html)

## 找不到安装位置时

安装器检查 PATH 中的 CLI、常见安装位置和当前 DSH 进程；进程只帮助定位，仍需验证包身份与配置归属。自定义目录可在菜单手动输入。

每个安装包附带可编辑的 `settings.json`：`dshHome` 是包含 profiles 的配置主目录，`dshRoot` 是 DSH 包目录，`hostNode` 是目标 DSH 的运行时，`desktopApp` 是桌面应用位置，`searchPaths` 是其他待查路径。留空自动查找，非空字段优先于环境变量。Windows 路径可用正斜杠，如 `D:/Apps/DSH`。不要把 shell 命令粘贴进路径字段。

Windows 用 `install.cmd diagnose`，macOS/Linux 用 `sh install.sh diagnose` 查看只读诊断。完整包的 Node 用于运行安装器，不会自动冒充目标宿主的 Node。找到唯一的受支持 Desktop 后自动使用它并显示五项操作。选择第 1 项直接安装随包管理器，不再要求 yes。正常安装不要求 DSH 退出；安装完成后重启即可。第 3 项仍可继续旧的待处理任务。多个独立环境才要求选择目标。其他桌面版本尚未适配。

常规安装只检查离线成品和目标配置，Desktop 调用应用自带的独立插件安装后端，CLI 调用对应 DSH 的公共插件命令；不扫描或备份整个已安装依赖目录。失败会记录真实错误与日志，不自动回滚；可以重新安装成品或先前版本。旧版恢复点仍可恢复。

Desktop 安装不修改或重新解析共享依赖树，成品在独立目录安装后由 Desktop 接入。CLI 使用随包 pnpm 10/11 兼容工具，按现有 profile 的记录选择，并核对 store 实际路径。目标 DSH 的运行时保持原样，安装工具不修改全局 pnpm 配置。
