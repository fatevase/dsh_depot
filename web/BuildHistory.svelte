<script>
 import {categories,platforms,dateLabel} from './catalog.mjs'
 import {loadRecord} from './record-client.mjs'
 let index=$state(null),error=$state(''),retry=$state(0)
 let query=$state(''),category=$state('all'),target=$state('all'),status=$state('all')
 $effect(()=>{
  const attempt=retry,controller=new AbortController();error=''
  loadRecord('builds/index.json',{signal:controller.signal}).then(value=>{
   if(!Array.isArray(value.records))throw Error('构建索引无效')
   index=value
  }).catch(e=>{if(!controller.signal.aborted)error=e.message})
  return ()=>controller.abort()
 })
 let records=$derived((index?.records??[]).filter(r=>(category==='all'||r.category===category)&&(target==='all'||r.target===target)&&(status==='all'||r.status===status)&&(!query.trim()||`${r.name} ${r.repository}`.toLowerCase().includes(query.trim().toLowerCase()))))
 const labels={compiled:'已构建 · 未离线验证',failed:'构建失败',missing:'未收到结果'}
 const href=r=>`plugin.html?${new URLSearchParams({id:r.pluginId,platform:r.target,tab:'proof'})}`
</script>
<section class="dv-wrap" style="padding-block:35px">
 <div class="dv-breadcrumb"><a href="plugins.html">插件目录</a><span>/</span><span>构建记录</span></div>
 <div class="dv-section-head"><h1>构建记录</h1><a class="dv-text-link" href="builds/index.json">JSON 索引 ↓</a></div>
 {#if error}<p role="alert">{error} <button class="dv-secondary" onclick={()=>retry++}>重新加载</button></p>{:else if !index}<p role="status">正在读取构建索引…</p>{:else}
  {#if index.campaign}<p class="dv-muted">批次 {index.campaign.runId} / {index.campaign.runAttempt??1} · {dateLabel(index.campaign.completedAt)} · {index.campaign.counts.compiled} 项已构建 · {index.campaign.counts.failed} 项失败 · {index.campaign.counts.missing} 项无结果</p>{/if}
  <div class="dv-build-filters"><input class="dv-select" type="search" aria-label="搜索构建记录" placeholder="插件或仓库" bind:value={query}><select class="dv-select" aria-label="构建分类" bind:value={category}>{#each Object.entries(categories) as [key,label]}<option value={key}>{label}</option>{/each}</select><select class="dv-select" aria-label="构建平台" bind:value={target}>{#each Object.entries(platforms) as [key,label]}<option value={key}>{label}</option>{/each}</select><select class="dv-select" aria-label="构建状态" bind:value={status}><option value="all">全部状态</option>{#each Object.entries(labels) as [key,label]}<option value={key}>{label}</option>{/each}</select></div>
  <p class="dv-muted">{records.length} 条记录</p>
  <div class="dv-build-table"><table><thead><tr><th>插件</th><th>分类</th><th>平台</th><th>状态</th><th>记录</th></tr></thead><tbody>{#each records as r}<tr><td><a class="dv-text-link" href={href(r)}>{r.name}</a><small>{r.repository}</small></td><td>{categories[r.category]}</td><td>{platforms[r.target]}</td><td>{labels[r.status]}{r.warnings?` · ${r.warnings} 条警告`:''}{r.errorCategory?` · ${r.errorCategory}`:''}</td><td><a class="dv-text-link" href={href(r)}>查看详情 →</a></td></tr>{/each}</tbody></table></div>
  {#if !records.length}<p class="dv-empty">没有匹配的构建记录。</p>{/if}
 {/if}
</section>
