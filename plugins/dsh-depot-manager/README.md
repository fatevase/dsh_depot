# DSH 离线插件管理器

在 DSH 内查看、安装和移除离线插件，支持拖入已构建的 .tgz 或成品目录，卸载默认保留配置和业务数据。

`plugin/` 是装入 DSH 的插件，`core/`、`adapters/`、`worker/` 管理检查与操作，`bootstrap/` 提供终端安装入口。build.mjs 生成已编译的标准插件，build-bootstrap.mjs 将插件与入口放进完整包或轻量包。构建验证与发布编排位于 `distribution/manager/`。

在仓库根目录运行 `npm run manager:test`；`npm run manager:build` 默认构建当前平台轻量包，输出 `.runtime/manager-local/`。平台选项、依赖准备和完整包要求见[维护说明](../../MAINTAINING.md)。

目前适配 DSH 0.2.1-rc.2 CLI/Web，以及官方 DeepSeek Harness Desktop 0.2.1-rc.2 的 macOS/Windows 安装布局；保留 macOS DSH Desktop 0.12.0 兼容。Desktop 使用应用自带 DSH、Electron 和 pnpm，实际平台验证结果见随包报告。网站提供三平台完整包和轻量测试包，并显示尚未完成的验收及已知失败。测试版可下载，不代表已通过完整原生验收。

[下载管理器与查看逐步说明](https://fatevase.github.io/dsh_depot/manager.html)

## 找不到安装位置时

安装器检查 PATH 中的 CLI、常见安装位置和当前 DSH 进程；进程只帮助定位，仍需验证包身份与配置归属。自定义目录可在菜单手动输入。

每个安装包附带可编辑的 `settings.json`：`dshHome` 是包含 profiles 的配置主目录，`dshRoot` 是 DSH 包目录，`hostNode` 是目标 DSH 的运行时，`desktopApp` 是桌面应用、安装目录、EXE 或 `dsh.cmd` 的位置，`searchPaths` 是其他待查路径。留空自动查找，非空字段优先于环境变量。Windows 路径可用正斜杠，如 `D:/Apps/DSH`。不要把 shell 命令粘贴进路径字段。

Windows 用 `install.cmd diagnose`，macOS/Linux 用 `sh install.sh diagnose` 查看只读诊断。完整包的 Node 用于运行安装器，不会自动冒充目标宿主的 Node。找到唯一的受支持 Desktop 后自动使用它并显示五项操作。选择第 1 项直接安装随包管理器，不再要求 yes。官方 Desktop 0.2.1 的命令要求先完全退出应用，运行中提交会保存任务，退出后选择第 3 项继续；CLI/Web 与旧版 Desktop 可运行中安装。安装完成后重新打开或重启。第 3 项仍可继续旧的待处理任务。多个独立环境才要求选择目标。未支持的核心版本会显示明确原因。

常规安装只检查离线成品和目标配置，直接调用对应 DSH 的公共插件命令；不扫描或备份整个已安装依赖目录。失败会记录真实错误与日志，不自动回滚；可以重新安装成品或先前版本。旧版恢复点仍可恢复。

安装助手复用目标 DSH 的包管理入口。Desktop 使用应用自带的 pnpm、启动包装和锁恢复入口；CLI 使用其原有解析方式。安装包不再附带另一套 pnpm，也不按 profile 记录另选版本或强制指定 store。缺少 Desktop 安装入口时会说明具体问题，请先修复或更新 DSH。完整包内的 Node 仅用于启动安装助手，安装操作使用目标 DSH 的运行时。

官方 Windows Desktop 的入口为 `resources/runtime/cli/bin/dsh.cmd`，内部调用 `DeepSeek Harness.exe` 和 `app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js`。安装助手等价调用这个专用入口，不要求 PATH 已注册 dsh。默认配置主目录为 `~/.dsh`，插件配置在 `profiles/desktop`；自定义时填写 `dshHome`，不要填写 Electron 的 AppData 设置目录。先启动 Desktop 完成初始化。自动发现还会读取 Windows 卸载注册表的 InstallLocation，失败时可手动指定路径。
