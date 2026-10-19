<script>
 import {verificationRows,proofLabels} from './proof.mjs'
 import {dateLabel} from './catalog.mjs'
 let {package:pkg,plugin}=$props()
 let rows=$derived(verificationRows(pkg))
</script>
<div class="dv-proof-summary"><span class="dv-kicker">当前所选安装包</span><h3>{pkg?.verification?.status==='passed'?'基础离线验证通过':pkg?'基础离线验证未通过':'尚无可下载安装包'}</h3><p>构建、安装验证和完整功能验收分别记录；基础检查通过不代表所有业务功能均已测试。上游更新时间是仓库推送时间，不代表本包已同步到最新版本。</p></div>
<dl class="dv-facts"><div><dt>包版本</dt><dd>{pkg?.version??'尚未发布'}</dd></div><div><dt>上游更新</dt><dd>{dateLabel(plugin?.upstreamUpdatedAt)}</dd></div><div><dt>离线包发布</dt><dd>{dateLabel(pkg?.publishedAt)}</dd></div><div><dt>构建工具</dt><dd>{pkg?.toolchain?('Node '+pkg.toolchain.node+' · npm '+pkg.toolchain.npm+' · pnpm '+pkg.toolchain.pnpm):'详见原始报告'}</dd></div></dl>
<h3>源码与打包</h3><dl class="dv-facts"><div><dt>源码固定提交</dt><dd class="dv-mono">{pkg?.source?.commit??'尚无记录'}</dd></div><div><dt>归档打包耗时</dt><dd>{Number.isFinite(pkg?.timings?.packaging)?pkg.timings.packaging.toFixed(2)+' 秒':'原始报告中查看'}</dd></div><div><dt>下载体积</dt><dd>{Number.isFinite(pkg?.compressedBytes)?(pkg.compressedBytes/1e6).toFixed(2)+' MB':'尚无记录'}</dd></div><div><dt>解压体积</dt><dd>{Number.isFinite(pkg?.unpackedBytes)?(pkg.unpackedBytes/1e6).toFixed(2)+' MB':'尚无记录'}</dd></div></dl>
{#if pkg?.dependencies}<details class="dv-guide-trouble"><summary>查看运行依赖清单</summary><p class="dv-muted">以下为包清单声明的直接运行依赖；不包含宿主提供的接口，也不代表外部 API 可离线使用。</p><ul>{#each Object.entries(pkg.dependencies.required??{}) as [name,version]}<li class="dv-mono">{name} · {version}</li>{/each}{#each Object.entries(pkg.dependencies.optional??{}) as [name,version]}<li class="dv-mono">{name} · {version} · 可选</li>{/each}{#if !Object.keys(pkg.dependencies.required??{}).length&&!Object.keys(pkg.dependencies.optional??{}).length}<li>未声明额外 npm 运行依赖</li>{/if}</ul></details>{/if}
<h3>隔离环境下的实际检查</h3>
<ol class="dv-verification-steps">{#each rows as row}<li><div><h3>{row.label}</h3><p>{row.description}</p></div><span class="dv-check-result" class:dv-check-failed={row.state==='failed'} class:dv-check-passed={row.state==='passed'}>{proofLabels[row.state]}</span></li>{/each}</ol>
{#if pkg?.sourceArchiveSha256}<details class="dv-guide-trouble"><summary>查看源码归档摘要</summary><code class="dv-code">{pkg.sourceArchiveSha256}</code></details>{/if}
