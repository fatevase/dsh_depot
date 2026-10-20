# 本机插件导出验证

2026-10-20。此记录针对首版本机导出；目标包仅包含程序与运行依赖。

- macOS arm64 / 原版 DSH 0.2.0-rc.2 / Node26.9.0：独立源安装 → 导出 → 空缓存、OS 断网目标安装 → 配置注册检查 → 宿主启动通过。测试插件含多级依赖、嵌套多版本和 npm alias。源 profile 的声明和数据标记保持不变。
- 本地 CLI 示例包2076字节，导出0.079秒，目标安装2.086秒；这是小型验收样例，不代表大型插件耗时。
- Desktop0.12.0 / 内置 Node24.17.0：完整打包的管理器在独立配置中完成 RPC 导出、worker 执行和鉴权下载。匿名请求401，下载摘要匹配；另一份独立 Desktop 配置安装与配置合成通过。此 Desktop smoke 不单独宣称 OS 断网，断网证据来自上一项原版 DSH 测试。
- 浏览器检查：保持原有布局和颜色；导出创建、运行中禁用、取消、ready、错误、390px 窄屏换行均已检查。
- pnpm 外链、相同版本不同依赖上下文、workspace、缺失项、依赖环、未知 peer、配置排除、源变化、下载越权与租约由行为测试覆盖。

原始结构化结果：[local-validation.json](local-validation.json)。Windows/Linux 原生迁移由 manager-distribution 的三个 runner 执行；只有本机导出迁移通过的 runner 才会生成发布收据。各平台最终结果以 Actions 的 export-roundtrip.json 为准，不将本机源环境当作发布包的验证环境。

复现原版测试：准备 distribution/host 中冻结的 DSH 环境后调用 distribution/manager/export-roundtrip.mjs 的 verifyExportRoundTrip。可选 Desktop 测试通过 Electron 的 ELECTRON_RUN_AS_NODE 模式运行 distribution/manager/desktop-export-smoke.mjs，参数为全新工作目录和管理器 .tgz；脚本拒绝复用已存在的测试目录。
