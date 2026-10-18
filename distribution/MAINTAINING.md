# DSH Depot 维护说明

在人工维护的 recipe 上执行：发现版本 → 确定输入 → 平台构建 → 原版 DSH 冷安装验证 → 不可变发布 → 静态目录。没有 Agent、LLM、自动改代码或任意仓库在线编译入口。

## 网站与统一仓库

唯一目标仓库是 `fatevase/dsh_depot`，配置在 `distribution/config.json` 的 `distributionRepository`。状态分支、Releases、Pages 共用这个目标。命令行 `--repository` 只能核对目标，不能覆盖配置；CI 如果运行在别的仓库会在访问远端前停止。

网站采用 Svelte 5 + Vite，源码位于 `distribution/web/`。保留已确认的融合设计：分类按钮列表、目标平台下拉框、筛选标签、详情双标签页和平台状态。构建输出为四个静态入口，使用相对资源路径，支持 Pages 仓库子路径。`site` 命令会编译前端再写入目录数据；不需要单独的常驻前端服务。开发预览运行 `npm --prefix distribution run web:dev`。

## 首轮 Top 10 测试

`config.json` 的 `cohort` 固定本轮清单，来源是 DSH Hub 的公开实时 API `scope=all&sort=trending&limit=10`，原始排名摘要位于 `cohorts/trending-top10-2026-10-18.json`。网页搜索缓存与实时榜单可能不同；本轮包含 DSH Market，不包含已经移出前十的 Answer me with HTML。

本轮有 8 个可构建项目，对 macOS arm64、Linux x64、Windows x64 各建一个任务；DSH Web 聚合包和 DSH TUI 明确记录为 `needs_recipe`，不会伪造安装包。前者需要递归工作区依赖打包，后者还需要源码子模块、终端安装和交互验证。未获取有效源码、宿主不兼容、构建失败、验证失败均在计划/状态/报告中保留。已完成的未验证包按当前发布策略提供下载。

源码固定到人工核对的 commit，避免首轮测试中途漂移。Sidebar 与 Market 先采用已经与冻结宿主验证过的兼容版本 0.26.0 / 1.66.38，不冒充最新上游。正常追踪新版本时，维护者再把审核过的渠道切回 tags/releases 或显式 branch。

`treg` 分发范围是上游 DSH 技能包，Python CLI/服务并未包含；外部 MCP 仍需要凭据及网络。保留其完整自定义许可证，以 `LicenseRef-tools-registry` 标识。Routing Suite 的根包只打包 Injector，且上游 manifest/许可证文件标注不同，目录使用 `LicenseRef-Upstream-Conflict` 并保留原文件。

## 本地运行

从仓库根目录运行。Node **26.9.0**、Python ≥3.9；构建器会在专用目录准备 recipe 固定的 npm/pnpm。准备宿主与构建需要联网，验证阶段自动断网。

```sh
npm --prefix distribution ci --ignore-scripts --registry=https://registry.npmjs.org
npm run distribution:test
node distribution/cli.mjs discover --output .runtime/distribution/discovered.json
node distribution/cli.mjs plan --discovered .runtime/distribution/discovered.json --output .runtime/distribution/plan.json
```

读取 `plan.json` 中的 `tasks[].buildKey`，将下列 `BUILD_KEY` 替换为本机目标任务的完整 key：

```sh
node distribution/cli.mjs build --plan .runtime/distribution/plan.json --key BUILD_KEY --output .runtime/distribution/jobs/BUILD_KEY/receipt.json
node distribution/cli.mjs verify --plan .runtime/distribution/plan.json --key BUILD_KEY --artifact .runtime/distribution/jobs/BUILD_KEY/receipt.json --output .runtime/distribution/jobs/BUILD_KEY/verification.json --receipt-output .runtime/distribution/jobs/BUILD_KEY/receipt.json
node distribution/cli.mjs publish --receipts .runtime/distribution/jobs --plan .runtime/distribution/plan.json --output .runtime/distribution/publication-plan.json
node distribution/cli.mjs site --catalog .runtime/distribution/catalog.json --output .runtime/distribution/site
python3 -m http.server 4188 --bind 127.0.0.1 --directory .runtime/distribution/site
```

`publish` 默认 **dry-run**：检查字节及报告，生成计划与空的已发布目录，不上传、不伪造公开链接。`--source-archive /absolute/source.tgz` 可对已冻结计划使用本地源码归档；seed 归档 SHA 在 recipe 中固定并传入正式计划；没有冻结归档 SHA 时禁止本地归档替换。每次 build/verify 创建新的尝试目录。完整 receipt 的资产路径相对于 receipt，下载 Actions 暂存包后仍可复验，不依赖原 runner 绝对路径。

## 维护规则

- `recipes/*.json` 只接收人工审核的规范 GitHub 仓库、npm 身份、版本范围、宿主范围、目标、锁和 argv 命令。新增发现只进入 `candidates`，不会自行执行。
- 上游构建锁使用 `npm ci` / `pnpm --frozen-lockfile`；运行闭包只消费 `locks/*-runtime.json` 中审核过的精确版本。生产依赖名称或范围超出适配锁时失败并提示 `needs_recipe`，维护者先更新锁，再重建。普通 build 不生成新锁。
- 构建安装关闭生命周期脚本；recipe 的显式构建命令仍会执行上游代码。环境不继承用户 token、npmrc 或 HOME。构建应在专用 CI runner 上执行；这不是面向恶意源码的文件系统沙箱。
- `packageRules.localPackages` 从相同源码提交打包嵌套 client。保留 peer、公开 exports、许可证、可选原生文件，不盲目裁剪依赖。当前 Sidebar 的公开子路径需要保留较大的运行闭包。
- `metadata.json` 维护网站描述与目录顺序，不影响构建 key。源码、recipe、依赖锁、平台、宿主、打包器和验证器版本共同决定 key。宿主清单、工作区设置和 pnpm 锁的摘要也会进入 key，并在宿主准备和验证时核对。改动打包/验证语义时提升 `lib/model.mjs` 对应版本。
- tag 身份另存不可丢弃的 refHistory，删除或离开发现窗口后重新出现也会检查原 SHA。tag 移动视为冲突；显式 branch 渠道允许 commit 前进。Mobile 的规范包是 `@april-jk/dsh-mobile`，不是其他同名项目。

## 验证边界

验证使用独立冻结 pnpm 宿主、全新 HOME / DSH_HOME / npm cache / pnpm store。DSH profile 建在仓库之外的临时目录中，阻止从 Workbench 的上层 node_modules 借用依赖；原生探针另检查解析来源必须位于安装闭包。使用原版 `dsh plugin add --offline --ignore-scripts`，检查配置合成、鉴权后 HTTP 200、插件 client 模块登记；Multi-root 另在断网子进程中实际加载 Koffi 和 flock。技能型包使用显式的配置注册行、随包技能文件和宿主启动门禁，报告不伪称存在 Web 客户端。没有覆盖完整浏览器业务功能、技能调用或外部 API 功能。

每次验证先证明非回环 TCP 地址在隔离前可达，隔离后 Node、Node 子进程与 Python 均不可达；另用 IPv6-mapped IPv4 socket 检查另一地址族。该对照不等同于对原生公网 IPv6 路由的实测。策略本身封锁全部网络，再按平台开放启动所需入口。控制失败保留 `unverified`。配置 `publication.allowUnverified: true` 后，已完成打包且有匹配验证失败记录的包也可发布，但必须保留未验证状态和失败原因。

- macOS：Seatbelt 的 `localhost` 包含本机其他网卡地址。安装禁用全部网络；启动仍禁止全部出站，DSH 显式绑定 `127.0.0.1`，沙箱外观察器只访问该页面。依赖主动出站回连本地服务的插件可能失败。
- Linux：独立 network namespace；安装无接口，启动仅开启 lo。GitHub 托管 runner 用 `sudo unshare -n` 创建 namespace 后，降回调用者 UID/GID 执行验证，个人 Linux 使用非特权 user namespace，能力不足不通过。
- Windows：仅允许 GitHub 托管的临时 runner 使用防火墙适配器，具有超时和独立清理进程。系统若豁免 loopback、阻断无效或清理条件不满足即不通过。不会在日常用户电脑上修改防火墙。

Top10 实测已有 8 个 macOS arm64 和 8 个 Linux x64 当前版本包通过 CI 验证。Windows 当前 7 个包已完成打包但网络隔离控制未通过，按未验证包发布；ModLens 编译失败，不提供下载；配置目标不表示已验证支持。

## 发布与恢复

真实发布从统一配置读取目标，并持有该仓库 `contents:write` token：

```sh
node distribution/cli.mjs publish --receipts .runtime/distribution/jobs --plan .runtime/distribution/plan.json --state .runtime/distribution/state.json --batch 12345 --publish --output .runtime/distribution/publication-plan.json
```

每个 Release 仅列出 `插件-版本-平台.tgz`、一份 `SHA256SUMS` 和一份 `reports.json`。例如 `market-1.66.38-darwin-arm64.tgz`。完整构建 key、来源提交、依赖和验证证据放在合并报告中，文件名不包含 key。

批次一般使用 GitHub run ID。每个 receipt 必须与批准计划的 recipe、源码、宿主、平台和重新计算的 key 完全一致，额外或重复 key 拒绝。先建立 draft Release，所有资产上传后核对 SHA-256，再公开。下载 URL 使用批次的正式 tag 构造，禁止把 GitHub 草稿的 `untagged-*` 临时 URL 写入目录；公开后逐一检查下载、校验清单与报告地址，失败时不提交新发布状态。已有同名资产只核对，永不覆盖。上传后状态写入失败时，重跑同批次及保留下来的 receipt，可恢复已有资产。公开批次如果缺资产，使用新批次，不向公开 Release 追加未核对的资产。

旧版命名/链接的当前包会从正式 Release 按文件名和 SHA-256 找回，下载后再次核对原始字节，并使用原有已验证 receipt 通过正常门禁重新发布。只更新相同 build key 的下载元数据；不重新编译、不更改包字节、不删除历史 Release。`presentationVersion: 2` 标记已整理的发布，后续跳过。

`distribution-state` 分支存储来源、候选、失败报告、发布元数据及当前下载指针，独立于 Actions cache。状态提交使用非强制更新和最多两次 CAS 重试；已发布平台继续可用，新版失败平台保留旧包。缺少 matrix receipt 会记录为 `missing`。相同失败输入不会自动反复编译，手动 `plan --retry-key KEY` 或 `--retry-key PLUGIN_ID` 才重试。

```sh
node distribution/cli.mjs state-read --output .runtime/distribution/state.json
node distribution/cli.mjs withdraw --state .runtime/distribution/state.json --key KEY --reason '原因' --output .runtime/distribution/withdrawal.json
node distribution/cli.mjs rollback --state .runtime/distribution/state.json --plugin taskfold --target darwin-arm64 --key OLD_KEY --output .runtime/distribution/rollback.json
```

以上两种状态变更默认本地预演；加 `--publish` 才写远端。回滚只接受相同宿主与平台、已发布已验证且未撤回的既有包。撤回后重新生成并部署站点；旧 Release 字节保留，目录不再提供该 key。

## 首次部署

1. 目标固定为 `fatevase/dsh_depot`。用 `node distribution/export.mjs --output .runtime/dsh-depot-repository` 生成独立的分发仓库文件，包括 `distribution/`、workflow 和最小根入口；不会带入桌面 Workbench、node_modules、本地运行产物或其他未跟踪文件。
2. Settings → Pages 选择 GitHub Actions，允许 Actions 创建 Releases 和 `distribution-state` 分支。公共仓库可使用标准托管 runner；具体免费额度以账户及 GitHub 当前政策为准。
3. 仅默认分支允许发现与发布，非默认分支手动运行也不会获得发布入口。各 job 使用发现阶段固定的提交。手动触发 `DSH plugin distribution`，可指定插件、平台及 retry key。默认每天 UTC 03:23，PR 只跑测试，不发布。
4. 按 `discover → plan → matrix(build+verify) → publish → pages` 检查报告。matrix 单平台失败不取消其他平台；发布器始终汇总：验证通过的包正常发布；配置允许时，已完成打包且验证失败的包标为未验证发布；构建失败、缺少包或身份/校验和不匹配的记录拒绝发布。
5. Pages job 独立重试时读取最新状态重新生成站点，与发布 job 共用串行边界，避免旧 artifact 恢复已撤回链接。暂存 artifacts 留两天，最终字节存 Releases。官方 Actions 以 2026-10-18 解析的 commit 固定；workflow 文件使用 JSON 形式的合法 YAML，便于直接进行结构化权限测试。

公开站点为 https://fatevase.github.io/dsh_depot/ 。Pages Source 已设为 GitHub Actions。平台支持和当前可下载包，以目录中的正式发布及验证记录为准。

## 规模扩展

一个仓库维护几百个插件的 recipe，不保存上游源码副本。发现阶段只为有变化或显式重试的输入生成任务，各平台在独立 runner 构建。当前试验冻结趋势榜 Top 10，尚未实现大规模队列与批次调度；扩到几百个之前需要增加分批、并发预算和失败重试配额，不能直接把几百个插件一次塞进现有 matrix。

## 暂缓的小项

目录已保留失败记录，但页面尚未展示更新失败/不兼容的时间与原因；公开 provenance 尚未补齐 runner image 及外层 receipt 中的 source archive SHA（这些仍在本地 build receipt / 验收报告中）。这两项已列为最终审查的次要待办。

## 未验证包发布

产品配置 `publication.allowUnverified` 显式启用未验证下载。它只影响发布策略，不放宽验证器，也不把失败检查改为通过。未验证记录必须处于 verify 阶段，保留匹配 buildKey、平台、宿主和 SHA-256 的验证失败证据，并存在完整包字节。缺少验证报告、构建失败或被撤回的包仍拒绝。

首次启用策略时，发布器可从本仓库默认分支的 distribution workflow 查找尚未过期的 Actions 构建产物，核对原记录及包摘要后复用；不重新编译。过期产物在报告的 unavailableBuilds 中列出，需要显式重试重建。发布 job 仅增加 actions:read 以下载这些产物。验证通过状态与 unverified 发布通道一起写入 reports.json 和目录；同 key 后续验证通过可升级状态。

站点将未验证包显示为琥珀色，下载按钮写“下载未验证包”，说明已失败或尚未完成的检查；“只看验证通过的包”排除它们。通用安装说明位于独立 guide.html，详情保留包对应的命令和校验值。
