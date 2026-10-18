<script>
  import { categories, packagesFor, bytes, platforms } from './catalog.mjs'
  import PluginIcon from './PluginIcon.svelte'
  let {plugin, catalog, target='all', href} = $props()
  let packages = $derived(packagesFor(catalog,plugin.id).filter(p=>target==='all'||p.target===target))
  let smallest = $derived([...packages].sort((a,b)=>a.compressedBytes-b.compressedBytes)[0])
  let version = $derived(smallest?.version??plugin.seed?.version)
</script>

<article class="dv-plugin">
  <div class="dv-plugin-top"><span class="dv-plugin-mark" aria-hidden="true"><PluginIcon id={plugin.id}/></span><span class="dv-category-label">{plugin.label??categories[plugin.category]}</span></div>
  <h3><a class="dv-name-link" {href}>{plugin.name}</a></h3>
  <div class="dv-plugin-author">{plugin.repository.split('/')[0]}{#if version}<span class="dv-mono" style="margin-left:6px">v{version}</span>{/if}</div>
  <p>{plugin.description||plugin.npmName}</p>
  <div class="dv-plugin-bottom"><span>{smallest?`${platforms[smallest.target]?.replace(' · ',' ')} · ${bytes(smallest.compressedBytes)}`:plugin.status==='needs_recipe'?'待适配':target==='all'?'尚未发布':`${platforms[target]} · 待验证`}</span><a class="dv-text-link" {href}>查看详情 ↗</a></div>
</article>
