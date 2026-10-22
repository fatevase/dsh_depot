<script>
 import PluginArtwork from './PluginArtwork.svelte'
 import ExportsPanel from './ExportsPanel.svelte'
 import {pluginTitle,pluginDescription,localized} from './view.mjs'
 let {item,host,exports:jobs=[],busy=false,onback=()=>{},onexport=()=>{},oncancel=()=>{}}=$props()
</script>
<div class="detail-top"><button class="text-button" onclick={onback}>← 插件</button></div>
<section class="plugin-detail">
 <div class="detail-heading"><span class="plugin-artwork detail-artwork"><PluginArtwork {item} size={48}/></span><div class="detail-copy"><h1>{pluginTitle(item)}{#if item.name.startsWith('@deepseek-ai/dsh-experimental-')||item.meta?.experimental||item.meta?.beta}<span class="experimental">实验性</span>{/if}</h1><p class="plugin-description">{pluginDescription(item)}</p></div></div>
 <div class="detail-actions"><button disabled={busy||!item.exportable} title={item.exportReason??'打包插件程序与运行依赖'} onclick={()=>onexport(item)}>↓ 导出插件</button></div>
 {#if item.exportReason}<p class="subtle">{item.exportReason}</p>{/if}
 <dl class="plugin-facts"><div><dt>插件包</dt><dd>{item.moduleName??item.name}</dd></div><div><dt>版本</dt><dd>{item.version??'由当前 DSH 提供'}</dd></div><div><dt>状态</dt><dd>{item.enabled?'已启用':'已停用'}{item.phase==='failed'?' · 加载失败':''}</dd></div><div><dt>当前环境</dt><dd>{host?.profileName??'—'} · {host?.runtimeTarget??'—'}</dd></div></dl>
 {#if item.rows?.length}<section class="detail-section"><h2>包含的组件 <span class="subtle">{item.rows.length}</span></h2>{#each item.rows as row}<div class="component-row"><strong>{localized(row.meta?.title,row.moduleName)}</strong>{#if row.meta?.description}<p class="subtle">{localized(row.meta.description)}</p>{/if}</div>{/each}</section>{/if}
 <section class="detail-section"><h2>导出与迁移</h2><p class="subtle">只打包插件程序与运行依赖，配置留在原机。请在相同系统、架构及兼容版本的 DSH 中载入。</p>{#if jobs.length}<ExportsPanel items={jobs} oncancel={oncancel} {busy}/>{:else}<p class="empty">导出完成后，下载入口会显示在这里。</p>{/if}</section>

</section>
