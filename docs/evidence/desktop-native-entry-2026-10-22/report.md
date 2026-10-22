# Desktop 安装入口适配验证（2026-10-22）

0.1.10 分离官方 DeepSeek Harness Desktop 的 bundled-cli 布局与旧 DSH Desktop legacy-web 布局。自动发现、手动目录/EXE/dsh.cmd 输入、保留的 desktop profile、原生包管理器和安装后检查分别适配。

## 已完成

- 实际静态解包官方 Windows 0.2.1-rc.2 安装器，确认 app.asar/dsh、runtime/cli/bin/dsh.cmd、primary-runtime 的 Node 与 pnpm。文件摘要和版本见 report.json。
- 运行官方下载的 macOS arm64 Desktop 自带 Electron/Node 24.21.0 与 pnpm 11.28.5。在独立临时 DSH_HOME 初始化 desktop profile，自动发现目标，安装、重复安装并卸载最终管理器包均成功。pnpm 显示 downloaded 0。
- 使用官方 app-boot.initProfile 初始化测试配置；测试没有修改用户日常 Desktop 配置。安装直接使用 Desktop 专用 CLI，安装后 plugin list 核对，不用普通 CLI 启动 reserved desktop profile。
- 最终包摘要、实际运行时与每次操作状态见 report.json。
- 全项目测试：网页 14、管理器 131 通过（原有 2 项跳过）、分发 122 通过；网页生产构建通过。

## 验证边界

此次 macOS 回归是 CLI 与安装身份验证，未验证完整 Desktop 页面、插件实际激活或网络隔离。Windows 原生 CLI 回归已接入 Actions，结果随 native-desktop.json 提供；GitHub Windows 提升权限的临时 runner 仅绕过测试脚本的所有权检查，正常用户所有权与界面验收仍标记 unverified，不改变生产安装器的普通用户限制。Linux 保留 CLI/Web 入口，没有宣称官方 Linux Desktop 已验证。

## 官方依据

- [Desktop 命令、安装归属与 profile 规则](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/apps/desktop/README.zh.md)
- [Windows dsh.cmd](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/apps/desktop/cli/dsh.cmd)
- [Desktop 专用 CLI](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/apps/desktop-host/src/cli.ts)
