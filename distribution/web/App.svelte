<script>
  import { onMount } from 'svelte'
  import PluginCard from './PluginCard.svelte'
  import { categories, platforms, packagesFor, selectPlugins, searchUrl, bytes, downloadUrl, installCommand } from './catalog.mjs'
  let {initialPage='index.html',initialSearch='',initialGuide=false,initialCatalog=null}=$props()
  const params=new URLSearchParams(initialSearch)
  let catalog=$state(initialCatalog),error=$state(''),help=$state(initialGuide),helpPanel
  let options=$state({q:params.get('q')??'',category:categories[params.get('category')]?params.get('category'):'all',platform:platforms[params.get('platform')]?params.get('platform'):'all',verified:params.get('verified')==='1',sort:params.get('sort')??'curated'})
  let query=$state(options.q),target=$state(platforms[params.get('platform')]&&params.get('platform')!=='all'?params.get('platform'):'darwin-arm64'),tab=$state(params.get('tab')==='proof'?'proof':'install')
  const page=initialPage==='plugins.html'?'search':initialPage==='plugin.html'?'detail':'home'
  const returnValue=params.get('return')??'plugins.html'
  const back=/^(?:plugins|index)\.html(?:\?|$)/.test(returnValue)?returnValue:'plugins.html'
  let items=$derived(catalog?selectPlugins(catalog,options):[])
  let feature=$derived(catalog?.plugins.find(p=>p.id==='sidebar')??catalog?.plugins[0])
  let featuredPackage=$derived(feature?packagesFor(catalog,feature.id)[0]:undefined)
  let plugin=$derived(catalog?.plugins.find(p=>p.id===params.get('id')))
  let selectedPackage=$derived(plugin?packagesFor(catalog,plugin.id).find(p=>p.target===target):undefined)
  let packageHref=$derived(downloadUrl(selectedPackage?.packageUrl))
  let proof=$derived(selectedPackage?.verification)
  let canSortSize=$derived(catalog?.packages.some(p=>p.status==='published'&&p.verification?.status==='passed'&&(options.platform==='all'||p.target===options.platform)))
  let chips=$derived([
    ...(options.q?[{key:'q',label:`关键词：${options.q}`}]:[]),
    ...(options.category!=='all'?[{key:'category',label:categories[options.category]}]:[]),
    ...(options.platform!=='all'?[{key:'platform',label:platforms[options.platform]}]:[]),
    ...(options.verified?[{key:'verified',label:'仅验证通过'}]:[])
  ])
  function persistFilters(){
    const next=new URLSearchParams()
    for(const key of ['q','category','platform','sort'])if(options[key]&&!['all','curated'].includes(options[key]))next.set(key,options[key])
    if(options.verified)next.set('verified','1')
    history.replaceState(null,'',searchUrl(next))
  }
  function filter(key,value){options[key]=value;if(!canSortSize&&options.sort==='size')options.sort='curated';persistFilters()}
  function reset(){options={q:'',category:'all',platform:'all',verified:false,sort:'curated'};query='';persistFilters()}
  function remove(key){filter(key,key==='verified'?false:key==='q'?'':'all');if(key==='q')query=''}
  function detailUrl(id){const state=new URLSearchParams();for(const key of ['q','category','platform','sort'])if(options[key]&&!['all','curated'].includes(options[key]))state.set(key,options[key]);if(options.verified)state.set('verified','1');return `plugin.html?${new URLSearchParams({id,return:page==='search'?searchUrl(state):'index.html',...(options.platform!=='all'?{platform:options.platform}:{})})}`}
  function setDetail(key,value){if(key==='platform')target=value;else tab=value;const next=new URLSearchParams(location.search);next.set(key,value);history.replaceState(null,'',`plugin.html?${next}`)}
  function tabKey(e){if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const next=e.key==='Home'?'install':e.key==='End'?'proof':tab==='install'?'proof':'install';setDetail('tab',next);document.getElementById(`depot-${next}-tab`)?.focus()}
  async function openGuide(e){e?.preventDefault();help=true;const {tick}=await import('svelte');await tick();helpPanel?.scrollIntoView({block:'nearest'})}
  onMount(()=>{if(!catalog){fetch('catalog.json',{cache:'no-cache'}).then(r=>{if(!r.ok)throw Error('目录读取失败');return r.json()}).then(value=>{if(value.schemaVersion!==1)throw Error('目录版本不支持');catalog=value}).catch(e=>error=e.message)}})
</script>

<div id="depot-v2" aria-label="DSH Depot 插件仓">
  <header class="dv-header dv-wrap">
    <a class="dv-brand" href="index.html"><span class="dv-emblem" aria-hidden="true"><b></b><b></b><b></b><b></b></span>DSH Depot <small>插件仓</small></a>
    <nav class="dv-navigation" aria-label="网站主导航"><a href="index.html" aria-current={page==='home'?'page':undefined}>首页推荐</a><a href="plugins.html" aria-current={page!=='home'?'page':undefined}>插件目录</a><a href="#guide" onclick={openGuide}>安装指南</a></nav>
    <div class="dv-header-end">精选插件 <span class="dv-mono" style="margin-left:8px">/ DSH DEPOT</span></div>
  </header>
  <main>
    {#if error}
      <section class="dv-wrap dv-empty" role="alert"><h1>暂时无法读取插件目录。</h1><p>{error}</p><button class="dv-secondary" type="button" onclick={()=>location.reload()}>重新加载</button></section>
    {:else if !catalog}
      <p class="dv-wrap" style="padding-block:60px" role="status">正在读取插件目录…</p>
    {:else if page==='home'}
      <section class="dv-wrap" aria-label="推荐首页">
        <div class="dv-hero">
          <div class="dv-hero-copy"><div class="dv-kicker">Good plugins. Ready to go.</div><h1>好插件，<br>即刻就绪。</h1><p>我们挑选、构建，并验证每一个安装包。<br>找到适合你的，把好用的能力带回本地。</p><div class="dv-hero-actions"><a class="dv-primary" href="plugins.html">探索全部插件 <span aria-hidden="true">↗</span></a><button class="dv-text-link" type="button" onclick={openGuide}>如何离线安装 <span aria-hidden="true">→</span></button></div><div class="dv-caption"><span class="dv-dot"></span>首批 {catalog.plugins.length} 个公共插件 · DSH {catalog.host?.version??'版本见详情'}</div></div>
          {#if feature}
            <article class="dv-feature" aria-label={`本期推荐 ${feature.name}`}><div class="dv-feature-top"><span>THE EDITOR'S PICK / 01</span><span>{categories[feature.category]}</span></div><div class="dv-feature-identity"><span class="dv-feature-monogram" aria-hidden="true">{feature.mark??feature.name[0]}</span><div><h2>{#if feature.id==='sidebar'}Better<br>Sidebar.{:else}{feature.name}{/if}</h2></div></div><p>{#if feature.id==='sidebar'}让工作空间，各就其位。<br>更清晰的侧栏与导航，更顺手的日常工作。{:else}{feature.description}{/if}</p><div class="dv-feature-file">{featuredPackage?.fileName??feature.npmName}<br>{featuredPackage?`${platforms[featuredPackage.target]} · ${bytes(featuredPackage.compressedBytes)}`:'离线包尚未公开发布'}</div><div class="dv-feature-end"><span class="dv-muted">源码 <span class="dv-mono">{(featuredPackage?.source?.commit??feature.seed?.commit)?.slice(0,7)??'详见来源'}</span></span><a class="dv-text-link" href={detailUrl(feature.id)}>了解插件 ↗</a></div></article>
          {/if}
        </div>
        <div class="dv-principles">{#each [['人工精选','围绕真实用途，挑选值得安装的插件。'],['预先构建','带上运行依赖，省去本地编译与等待。'],['离线实测','空缓存安装，检查宿主启动与模块加载。']] as principle,i}<div class="dv-principle"><span class="dv-principle-number">0{i+1}</span><div><b>{principle[0]}</b><p>{principle[1]}</p></div></div>{/each}</div>
        <section aria-label="本期精选插件"><div class="dv-section-head"><div><div class="dv-kicker">The collection</div><h2>给工作流，加一点好用。</h2></div><a class="dv-text-link" href="plugins.html">浏览全部 {catalog.plugins.length} 个插件 →</a></div><div class="dv-recommendations">{#each catalog.plugins.slice(0,3) as p}<PluginCard plugin={p} {catalog} href={detailUrl(p.id)}/>{/each}</div><div class="dv-home-note"><span>精选收录 {catalog.plugins.length} 个 · 已发布 {catalog.packages.length} 个离线包</span><span>兼容、体积与验证范围，均可在详情中查看。</span></div></section>
      </section>
    {:else if page==='search'}
      <section class="dv-wrap" aria-label="插件搜索页面">
        <div class="dv-search-head"><div class="dv-breadcrumb"><a href="index.html">首页</a><span aria-hidden="true">/</span><span>插件目录</span></div><div class="dv-search-title"><div><div class="dv-kicker">The plugin directory</div><h1>找到适合你的插件。</h1><p>搜索精选插件，按用途、平台和验证状态，找到合适的离线包。</p></div><span class="dv-caption">首批精选 <span class="dv-mono">/ {String(catalog.plugins.length).padStart(2,'0')}</span></span></div><form class="dv-search-form" role="search" aria-label="搜索精选插件" onsubmit={e=>{e.preventDefault();filter('q',query.trim().slice(0,150))}}><label class="dv-input-wrap"><span aria-hidden="true">⌕</span><input type="search" name="query" aria-label="搜索插件关键词" placeholder="搜索插件、作者或功能…" autocomplete="off" bind:value={query}></label><button class="dv-primary" type="submit">搜索 <span aria-hidden="true">→</span></button></form></div>
        <div class="dv-search-layout">
          <aside class="dv-search-filters" aria-label="插件筛选条件">
            <div class="dv-filter-block"><span class="dv-filter-title">插件分类</span><div class="dv-category-list">{#each Object.entries(categories) as [key,label]}<button class="dv-category-button" type="button" aria-pressed={options.category===key} onclick={()=>filter('category',key)}><span>{label}</span><small>{catalog.plugins.filter(p=>key==='all'||p.category===key).length}</small></button>{/each}</div></div>
            <div class="dv-filter-block"><label class="dv-filter-title" for="depot-platform-v2">目标平台</label><select id="depot-platform-v2" class="dv-select dv-platform-filter" value={options.platform} onchange={e=>filter('platform',e.currentTarget.value)}>{#each Object.entries(platforms) as [key,label]}<option value={key}>{label}</option>{/each}</select><p class="dv-filter-note">不同平台独立构建与验证。<br>仅通过验证并发布的包可下载。</p></div>
            <div class="dv-filter-block"><span class="dv-filter-title">验证状态</span><label class="dv-check"><input type="checkbox" checked={options.verified} onchange={e=>filter('verified',e.currentTarget.checked)}><span>只看验证通过的包</span></label></div>
            <div class="dv-filter-block"><span class="dv-filter-title">当前宿主基线</span><span class="dv-mono dv-muted">DSH {catalog.host?.version??'版本见详情'}</span><p class="dv-filter-note">在详情中查看精确测试环境。</p></div>
          </aside>
          <section class="dv-results" aria-label="插件搜索结果">
            <div class="dv-result-tools"><span class="dv-result-count" aria-live="polite">找到 <strong>{items.length}</strong> 个插件</span><label class="dv-sort">排序<select class="dv-select" aria-label="结果排序" value={options.sort} onchange={e=>filter('sort',e.currentTarget.value)}><option value="curated">精选顺序</option><option value="size" disabled={!canSortSize}>包体积从小到大</option><option value="name">名称 A–Z</option></select></label></div>
            <div class="dv-chips">{#if chips.length}{#each chips as chip}<button class="dv-chip" type="button" aria-label={`移除${chip.label}筛选`} onclick={()=>remove(chip.key)}>{chip.label} <span aria-hidden="true">×</span></button>{/each}<button class="dv-muted" style="font-size:10px" type="button" onclick={reset}>清除全部</button>{:else}<span>精选收录 · 来源与验证范围可查</span>{/if}</div>
            {#if items.length}<div class="dv-result-grid">{#each items as p}<PluginCard plugin={p} {catalog} target={options.platform} href={detailUrl(p.id)}/>{/each}</div>{:else}<div class="dv-empty"><div class="dv-kicker">No matching packages</div><h2>暂时没有匹配的插件。</h2><p>{options.verified?'当前条件下还没有公开发布的验证包。可以取消“只看验证通过的包”，查看插件信息。':'试试其他关键词，或调整分类、平台与验证条件。'}</p><button class="dv-secondary" type="button" onclick={reset}>清除筛选，查看全部</button></div>{/if}
            <div class="dv-result-foot"><span>{items.length?`已显示全部 ${items.length} 个插件 · 首批收录 ${catalog.plugins.length} 个`:'没有符合当前条件的结果'}</span><span class="dv-result-page" aria-label="当前第 1 页">1</span></div>
          </section>
        </div>
      </section>
    {:else if plugin}
      <section class="dv-wrap" aria-label="插件详情页面">
        <div class="dv-detail-head"><div class="dv-breadcrumb"><a href={back}>← 返回</a><span aria-hidden="true">/</span><span>{categories[plugin.category]}</span><span aria-hidden="true">/</span><span>{plugin.name}</span></div><div class="dv-detail-title"><span class="dv-plugin-mark" aria-hidden="true">{plugin.mark??plugin.name[0]}</span><div><h1>{plugin.name}</h1><p><span>{plugin.repository.split('/')[0]}</span><span style="margin-inline:9px">/</span><span class="dv-mono">v{selectedPackage?.version??plugin.seed?.version??'待收录'}</span></p></div></div><p class="dv-detail-intro">{plugin.description||plugin.npmName}</p></div>
        <div class="dv-detail-layout">
          <div class="dv-detail-copy"><div class="dv-detail-tabs" role="tablist" aria-label="插件资料">{#each [['install','安装方式'],['proof','构建与验证']] as [key,label]}<button id={`depot-${key}-tab`} class="dv-detail-tab" role="tab" aria-selected={tab===key} aria-controls={`depot-${key}-panel`} tabindex={tab===key?0:-1} type="button" onclick={()=>setDetail('tab',key)} onkeydown={tabKey}>{label}</button>{/each}</div>
            <section id="depot-install-panel" role="tabpanel" aria-labelledby="depot-install-tab" hidden={tab!=='install'}><h2>把插件，带回本地。</h2><p>下载与你的系统架构对应的离线包，由原版 DSH 完成本地安装。</p>
              {#if selectedPackage}
                <div class="dv-install-step"><span>01</span><div><h3>确认环境与安装包</h3><p>当前包对应 {platforms[target]}。已验证宿主为 DSH {selectedPackage.host.version}、Node {selectedPackage.host.node}。</p></div></div>
                <div class="dv-install-step"><span>02</span><div><h3>核对 SHA-256</h3><p>下载后核对“构建与验证”中的产物校验值。</p></div></div>
                <div class="dv-install-step"><span>03</span><div><h3>从本地安装</h3><p>将命令中的相对路径替换为你的实际包路径。</p></div></div><code class="dv-code">{installCommand(selectedPackage)}</code><p>离线包包含运行依赖。DSH、Node 与外部 API 凭据需要预先准备。</p>
              {:else}<div class="dv-empty" style="text-align:left;padding:24px 19px"><h2>{platforms[target]}，还在准备中。</h2><p style="margin:10px 0 0">对应平台完成构建与空缓存离线验证并发布后，这里会提供包体积、下载和安装命令。</p></div>{/if}
            </section>
            <section id="depot-proof-panel" role="tabpanel" aria-labelledby="depot-proof-tab" hidden={tab!=='proof'}><h2>来源清楚，验证范围明确。</h2><p>{selectedPackage?'下面是当前所选平台安装包的验证范围。平台切换后，报告与校验值对应所选包。':'当前平台尚无公开发布的验证包，不标记为验证通过。'}</p>
              <ul class="dv-proof-list">{#each [['全新缓存 · 断网安装',proof?.checks?.install],['配置合成与宿主启动',proof?.checks?.compose&&proof?.checks?.host],['鉴权后的页面与模块登记',proof?.checks?.host&&proof?.checks?.clientModule],['浏览器内完整业务功能',null],...(proof?.scope?.includes('native-load')?[['原生依赖实际加载',proof.checks.native]]:[])] as [label,passed]}<li><span>{label}</span><small style:color={!passed?'var(--depot-muted)':undefined}>{passed?'通过':label==='浏览器内完整业务功能'?'未覆盖':'暂无报告'}</small></li>{/each}</ul>
              <p>{selectedPackage?`测试环境：${platforms[target]} · DSH ${selectedPackage.host.version} · Node ${selectedPackage.host.node}。其他平台独立验证。`:'各平台独立验证，切换目标平台查看对应记录。'}</p><h3 style="font-size:13px;margin-top:22px">产物校验值</h3><code class="dv-code">{selectedPackage?.sha256??'尚未发布'}</code><p class="dv-mono">源码：<a class="dv-text-link" href={`https://github.com/${plugin.repository}/tree/${selectedPackage?.source?.commit??plugin.seed?.commit??''}`}>{plugin.repository} · {selectedPackage?.source?.commit??plugin.seed?.commit??'待确认'}</a></p>{#if downloadUrl(selectedPackage?.reportUrl)}<a class="dv-text-link" href={downloadUrl(selectedPackage.reportUrl)}>查看验证报告 ↗</a>{/if}
            </section>
          </div>
          <aside class="dv-detail-side" aria-label="离线包选择"><div class="dv-kicker">Offline package</div><div class="dv-platform-choices" aria-label="详情目标平台">{#each Object.entries(platforms).filter(([key])=>key!=='all') as [key,label]}<button class="dv-platform-choice" type="button" aria-pressed={target===key} onclick={()=>setDetail('platform',key)}><span>{label}</span><small>{packagesFor(catalog,plugin.id).some(p=>p.target===key)?'验证通过':'尚未发布'}</small></button>{/each}</div><dl class="dv-detail-facts"><dt>包体积</dt><dd>{bytes(selectedPackage?.compressedBytes)}</dd><dt>兼容 DSH</dt><dd>{selectedPackage?.host?.version??catalog.host?.version??'待验证'}</dd><dt>许可证</dt><dd>{plugin.license??'待核对'}</dd></dl>{#if packageHref}<a class="dv-primary" style="width:100%;gap:12px" href={packageHref}>下载离线包 <span aria-hidden="true">↓</span></a>{:else}<button class="dv-primary" style="width:100%;gap:12px" type="button" disabled>尚未发布 <span aria-hidden="true">↓</span></button>{/if}<p class="dv-download-note">{packageHref?'已通过所选平台的离线验证。下载后请核对 SHA-256。':'当前平台尚无公开发布的验证包，不能提供下载。'}</p></aside>
        </div>
      </section>
    {:else}<section class="dv-empty dv-wrap"><h1>未找到这个插件。</h1><a class="dv-text-link" href="plugins.html">返回插件目录</a></section>{/if}
    <section id="guide" class="dv-help dv-wrap" bind:this={helpPanel} hidden={!help} aria-live="polite"><button type="button" class="dv-help-close" aria-label="关闭安装指南" onclick={()=>help=false}>×</button><h2>下载到本地，交给 DSH。</h2><p>先确认宿主版本与系统架构，下载对应的 .tgz 并核对 SHA-256，再执行详情中的本地安装命令。离线包包含插件运行依赖，DSH 和 Node 需预先安装。需要外部 API 的插件功能仍需联网；仅通过验证并完成发布的包可下载。</p></section>
  </main>
  <footer class="dv-footer dv-wrap"><span class="dv-footer-brand">DSH Depot <span class="dv-muted" style="font-size:10px;margin-left:10px">精选、构建、交付。</span></span><span>{catalog?.lastSuccessfulDiscoveryAt?`最近成功检查：${new Date(catalog.lastSuccessfulDiscoveryAt).toLocaleString('zh-CN')}`:'尚未完成来源检查'}</span></footer>
</div>
