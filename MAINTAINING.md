# DSH Depot 维护说明

## 仓库边界

| 目录 | 职责 | 输入与输出 |
| --- | --- | --- |
| `web/` | Svelte 网站：推荐、搜索、详情、下载、指南 | 读取 catalog.json / manager-catalog.json，输出静态页面 |
| `plugins/dsh-depot-manager/` | 管理器插件、Svelte 管理页、维护脚本、构建器及测试 | 输出标准插件 .tgz 和平台安装归档 |
| `distribution/` | 发现、recipes、规则判断、原生构建、离线验证和发布编排 | 更新状态分支、Release 与目录 |
| `packages/offline-format/` | 共用平台、文件清单、完整性及发布资格规则 | 无第三方依赖，不引用以上三个模块 |

管理器 CI 验证与发布入口留在 `distribution/manager/`，管理器本身的运行和打包代码不依赖流水线。网站只读取公开目录；分发适配器负责从状态生成目录。

根目录只有一份工作区 package-lock.json。`distribution/host/pnpm-lock.yaml` 和 recipe 的运行依赖锁是宿主/上游输入，不能替换为工作区锁。

## 本地开发

从仓库根目录运行，使用 Node 26.9.0。依赖已冻结，不运行安装脚本：

```sh
npm ci --ignore-scripts --registry=https://registry.npmjs.org
npm test
npm run web:test
npm run manager:test
npm run distribution:test
```

仅安装某模块依赖也从根锁选择工作区，例如 `npm ci --workspace @dsh-depot/web --ignore-scripts`。跨模块集成测试和全仓库测试需要完整工作区。

网站开发与构建：

```sh
npm run web:dev
npm run web:build
node web/build.mjs --catalog /absolute/path/catalog.json --manager-catalog /absolute/path/manager-catalog.json --output .runtime/web/site
```

无目录输入时生成真实空目录，不下载或编造插件。默认输出 `.runtime/web/site/`，五个入口和站点 URL 不变。本地构建不需要 GitHub 凭据。

管理器默认按当前平台生成标准插件和不附带 Node 的轻量包：

```sh
npm run manager:build
npm run manager:build -- --target macos-arm64 --flavor lite
npm run manager:build -- --target linux-x64 --flavor plugin
```

默认输出 `.runtime/manager-local/`，目标还包括 win32-x64。完整包使用 `--flavor full --runtime-archive /absolute/path/official-node-archive`，必须符合 `plugins/dsh-depot-manager/runtime-lock.json` 的官方 URL 与 SHA256。三平台完整 CI 入口仍为 `node distribution/manager/ci.mjs build TARGET OUTPUT`，需要对应原生 runner。

Windows 为 ZIP + install.cmd，macOS 为 tgz + install.command / install.sh，Linux 为 tgz + install.sh。用户安装时不编译。轻量包需已有兼容 Node；已验证本机独立 Node 复用，尚未证明所有 DSH 内置运行时均可自动发现。

热门候选和 active 构建名单统一保存在 `distribution/plugin-list.json`，用 `node distribution/cli.mjs list --output .runtime/distribution/plugin-list.json` 检查。当前保存 99 个候选快照，11 个 active 条目中仍包含明确待适配项目。

普通插件配置与维护步骤见 [distribution/MAINTAINING.md](distribution/MAINTAINING.md)。

## Actions 与发布

| 工作流 | 自动触发范围 | 发布权限 |
| --- | --- | --- |
| web-pages.yml | 网站、相关共享规则、根依赖；发布任务完成后刷新 | PR 仅测试与构建；默认分支才能部署 Pages |
| manager-distribution.yml | 管理器、共享格式、验证器、宿主和对应 CI 配置 | 分支/PR 无写权限；默认分支手动 publish 且完整验收后才发 Release |
| plugin-distribution.yml | 定时、手动、分发代码/配置与共享格式 | 默认分支执行发现、构建与发布；PR 无写权限 |

push 自动触发限定 main；功能分支通过 PR 检查，避免同一次更新重复消耗原生 runner。网站源码修改不触发两个原生构建矩阵；管理器源码修改不触发普通插件流水线。根依赖和共享格式修改可能同时触发相关检查。

两个构建工作流均不部署 Pages。网站收到 workflow_run 后，只接受本仓库默认分支的 push/schedule/workflow_dispatch，并检查 publish job 确实成功。不下载上游制品、不检出上游 ref，始终用默认分支代码读取最新状态重建。这也覆盖单平台失败但已成功发布带警告包的情况。Pages 与普通插件状态发布沿用相同互斥组，防止旧状态覆盖页面。

普通插件 allowUnverified 策略保持原样。管理器首装归档不继承此策略：缺双击、OS 网络隔离、原生加载或恢复等精确资产证据时保持 unverified。构建成功不能替代完整 31 项原生验收；没有合格资产时管理器下载目录保持为空。

Git 保存源码、配置、文档和收据。归档/缓存放 .runtime、Actions 或 Release，不提交进 Git。`node distribution/export.mjs --output .runtime/depot-export` 导出全部模块与根锁文件，排除依赖和运行目录。
