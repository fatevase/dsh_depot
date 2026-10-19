# 维护说明

## 管理器分发

`distribution/manager` 是独立命名空间。`manager-distribution.yml` 的 PR 构建无发布权限；正式发布必须在默认分支人工选择 publish，且精确资产必须通过完整管理器验收。普通插件的 allowUnverified 策略不可用于首装脚本。

管理器构建：`node distribution/manager/ci.mjs build macos-arm64 .runtime/manager-ci/macos-arm64`，另外两个目标为 linux-x64、win32-x64，需要对应原生 runner。Node 26.9.0 归档由 runtime-lock.json 的官方 URL 与 SHA256 固定，下载失败或哈希不符即停止。

验收分为单元测试、真实宿主集成和 31 项原生矩阵。缺 Windows/macOS 双击、Fedora/SSH、OS 网络隔离、原生加载或恢复证据时保持 unverified；不得用测试数量或构建成功补齐。报告绑定最终插件及安装包哈希，变更后重新验收。没有合格资产时 manager-catalog.json 保持空目录，网站不显示假下载。
