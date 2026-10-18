<script>
  import { categories, packagesFor, bytes, platforms, platformState } from './catalog.mjs'
  import PluginIcon from './PluginIcon.svelte'
  let {plugin, catalog, target='all', verifiedOnly=false, href} = $props()
  let packages = $derived(packagesFor(catalog,plugin.id).filter(p=>target==='all'||p.target===target))
  let smallest = $derived([...packages].sort((a,b)=>a.compressedBytes-b.compressedBytes)[0])
  let version = $derived(smallest?.version??plugin.seed?.version)
</script>

<article class="dv-plugin">
  <div class="dv-plugin-top"><span class="dv-plugin-mark" aria-hidden="true"><PluginIcon id={plugin.id}/></span><span class="dv-category-label">{plugin.label??categories[plugin.category]}</span></div>
  <h3><a class="dv-name-link" {href}>{plugin.name}</a></h3>
  <div class="dv-plugin-author">{plugin.repository.split('/')[0]}{#if version}<span class="dv-mono" style="margin-left:6px">v{version}</span>{/if}</div>
  <p>{plugin.description||plugin.npmName}</p>
  <div class="dv-plugin-bottom"><div class="dv-card-platforms" aria-label="平台包状态">{#each Object.entries(platforms).filter(([key])=>key!=='all'&&(target==='all'||target===key)&&(!verifiedOnly||platformState(catalog,plugin,key).package?.verification?.status==='passed')) as [key,label]}{@const state=platformState(catalog,plugin,key)}<span class:dv-status-unverified={state.unverified}>{label} · {state.label}{#if state.package} · {bytes(state.package.compressedBytes)}{/if}</span>{/each}</div><a class="dv-text-link" {href}>查看详情 ↗</a></div>
</article>
