# DSH Depot · 插件仓

为 DSH 提供按平台打包的插件安装包。你可以浏览插件功能、选择系统架构、下载安装包，再通过 DSH 从本地安装。

[浏览插件](https://fatevase.github.io/dsh_depot/plugins.html) · [安装指南](https://fatevase.github.io/dsh_depot/guide.html) · [下载发布包](https://github.com/fatevase/dsh_depot/releases)

## 可以在这里找到什么

- 插件介绍、来源、版本和兼容的 DSH 环境。
- 包含运行依赖的 `.tgz` 安装包，无需在安装设备上重新编译插件。
- 每个平台独立的下载、文件大小、SHA-256 和构建验证记录。
- 本地安装步骤，以及下载失败、文件路径和插件未启用等常见问题的处理方法。

目前从首批趋势榜插件逐步扩充。趋势、评分和评论榜去重筛选后的 99 个候选单独管理，只有完成构建配置并加入选品名单的项目才进入分发流水线。部分插件尚未完成打包，详情会显示当前状态；收录并不表示每个平台都有可用安装包。

## 选择适合你的包

| 系统 | 包中的平台标识 | 说明 |
| --- | --- | --- |
| macOS Apple Silicon | `macos-arm64` | 适用于 M 系列芯片，不能用于 Intel Mac |
| Linux x64 | `linux-x64` | 适用于 64 位 x86 Linux |
| Windows x64 | `win32-x64` | 独立构建与验证，下载前查看详情中的当前状态 |

平台和版本的最新状态以网站目录为准。macOS Intel、Linux arm64 和 Windows arm64 暂未纳入当前构建范围。

## 下载前看一下状态

**验证通过**：当前包已通过对应平台的空缓存离线安装、宿主启动及报告中列出的检查。完整业务功能、外部模型和 API 功能仍需要你按插件要求配置。

**未验证包（琥珀色）**：安装包已生成，但离线安装或运行验证未通过。可以下载，详情会说明原因及未完成的检查。例如，验证环境的网络隔离检查失败时，尚不能确认该包能够正常离线安装或运行。

**构建失败 / 待适配**：尚无完整安装包，因此暂不提供下载。可以继续查看插件介绍与来源。

目录提供“只看验证通过的包”筛选，方便按需要选择。

## 离线插件管理器

配套管理器支持拖入 `.tgz` 或已构建的成品目录，查看安装预览、已安装插件和恢复记录。卸载默认保留配置与业务数据。首次由脚本选择 DSH，后续从 DSH 的“离线插件”入口打开。

Windows 使用 `install.cmd`，macOS 使用 `install.command`，Linux / SSH 使用 `install.sh`。完整包附带独立 Node，轻量包复用符合要求的 Node。各平台只有完成对应验收才提供正式下载；目前开发分支的测试产物不等于正式安装包。

[管理器下载状态](https://fatevase.github.io/dsh_depot/manager.html) · [三平台与恢复指南](https://fatevase.github.io/dsh_depot/guide.html#manager)

## 如何安装

1. 准备 DSH、Node 和 pnpm，并确认系统架构与插件详情中的环境要求。
2. 在插件详情选择平台，下载 `.tgz`，不用解压。
3. 核对详情中的 SHA-256，复制该包对应的本地安装命令。
4. 重启 DSH，检查插件是否启用。外部服务可能还需要 API Key、账号和网络。

完整步骤与常见问题请看[安装指南](https://fatevase.github.io/dsh_depot/guide.html)。离线包包含插件运行依赖，不包含 DSH、Node 或外部服务账号。

## 来源与反馈

每个包都保留上游源码信息和许可证。部分项目仅分发其 DSH 插件部分，具体范围见插件详情；插件功能与许可要求以上游项目为准。

遇到问题，可以在 [Issues](https://github.com/fatevase/dsh_depot/issues) 中提供插件包名、系统架构、DSH 版本及完整报错，避免附上 API Key 等账号信息。

希望维护或扩展收录范围，请阅读[维护说明](https://github.com/fatevase/dsh_depot/blob/main/MAINTAINING.md)。

## 项目组成

网站、配套插件与分发流水线在同一仓库分别维护：

- [web](web/)：插件浏览、搜索、详情、下载和安装指南。
- [plugins](plugins/)：DSH 离线插件管理器及配套安装脚本。
- [distribution](distribution/)：插件发现、多平台打包、离线验证和发布。

详细开发与维护步骤见[维护说明](MAINTAINING.md)。

插件目录支持按上游更新时间或离线包发布时间排序。管理器的下载与操作步骤位于独立的管理器页面，原版 DSH 命令安装说明位于安装指南。已适配插件按固定规则分批构建；候选尚未适配时保留明确状态。
