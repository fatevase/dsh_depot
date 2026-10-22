# Desktop 原生命令适配实施计划

> 执行方式：当前会话直接实施，沿用用户已授权的重构、修复、打包和发布流程。

目标：安装助手识别官方 Desktop 0.2.1-rc.2 的 Windows/macOS 文件布局，复用其 CLI、Electron 和 pnpm，并允许手动指定安装位置。保留旧 Desktop 与普通 CLI/Web 适配。

依据：已静态解包官方 Windows 0.2.1-rc.2，核对 app.asar、runtime/cli/bin/dsh.cmd 和 primary-runtime；官方 desktop-host CLI 源码及 README 的 profile/锁约束。官方 Desktop 使用 DSH_HOME/profiles/desktop，普通 CLI 不可管理此保留配置。

- [x] 1. 回归测试：真实 ASAR 层级的 Windows/macOS 身份识别；目录、EXE、cmd、进程和自定义位置；残缺安装只读；普通应用排除。
- [x] 2. 将有界 ASAR 读取和 Desktop 布局识别拆入独立模块，发现器只收集路径与配置。Windows 同时检查卸载注册表 InstallLocation，失败保留手动入口。
- [x] 3. 接入新版 Desktop CLI 和物理 pnpm 路径，使用 Electron Node 模式重启助手；探测实际运行时及初始化的 desktop profile。旧版 web 配置与新版 desktop 配置分开。
- [x] 4. 安装/卸载调用官方 CLI，成功后使用 plugin list 和安装身份检查；拒绝以 --dump-config 启动保留 profile。仅新版 Desktop 根据官方规则等待退出，普通 CLI/Web 和旧版保持原行为；待处理任务可继续。
- [x] 5. 更新随包说明与兼容说明，保留五项操作菜单，不增加 yes 提示，不扫描/备份全依赖，不携带额外 pnpm。更新管理器版本。
- [ ] 6. 完整测试、构建并做隔离真实宿主验证；GitHub 三平台执行，审查后合并并更新下载。未真实验证的平台/界面不得宣称通过。

重点检查：含空格/特殊字符路径、ASAR link/越界/残缺文件、同一 home 下 desktop 与 web 共存、DSH_HOME 自定义及未初始化、应用运行与助手自身进程区别、失败日志保留。
