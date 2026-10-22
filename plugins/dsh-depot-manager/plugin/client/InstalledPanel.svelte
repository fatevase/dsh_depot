<script>
 import PluginArtwork from './PluginArtwork.svelte'
 import {pluginTitle,pluginDescription} from './view.mjs'
 let {items=[],onopen=()=>{}}=$props()
</script>
<section class="plugin-group" aria-label="已安装的第三方插件"><h2>已安装<span>{items.length}</span></h2>
{#if !items.length}<p class="empty">当前环境中还没有已安装的第三方插件。点击“载入插件”添加离线包。</p>{/if}
<ul class="plugin-list">{#each items as item (item.name)}<li class="plugin-row">
 <button class="plugin-open" onclick={()=>onopen(item)} aria-label={`查看${pluginTitle(item)}详情`}><span class="plugin-artwork"><PluginArtwork {item}/></span><span class="plugin-copy"><span class="plugin-title">{pluginTitle(item)}</span><span class="plugin-description">{pluginDescription(item)||item.name}</span>{#if item.problem}<span class="error">插件读取失败 · {item.problem}</span>{/if}</span><span class="row-version">{item.version??''}<span aria-hidden="true">›</span></span></button>
 </li>{/each}</ul></section>
