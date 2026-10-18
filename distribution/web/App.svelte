<script>
  import { onMount } from 'svelte'
  import PluginCard from './PluginCard.svelte'
  import PluginIcon from './PluginIcon.svelte'
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
  let currentPackageCount=$derived(catalog?catalog.plugins.reduce((n,p)=>n+packagesFor(catalog,p.id).length,0):0)
  let proof=$derived(selectedPackage?.verification)
  let installCopied=$state('')
  async function copyInstall(){try{await navigator.clipboard.writeText(installCommand(selectedPackage));installCopied='已复制'}catch{installCopied='请手动复制下方命令'}}
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
  function setDetail(key,value){if(key==='platform'){target=value;installCopied=''}else tab=value;const next=new URLSearchParams(location.search);next.set(key,value);history.replaceState(null,'',`plugin.html?${next}`)}
  function tabKey(e){if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const next=e.key==='Home'?'install':e.key==='End'?'proof':tab==='install'?'proof':'install';setDetail('tab',next);document.getElementById(`depot-${next}-tab`)?.focus()}
  async function openGuide(e){e?.preventDefault();help=true;const {tick}=await import('svelte');await tick();helpPanel?.scrollIntoView({block:'nearest'})}
  onMount(()=>{if(!catalog){fetch('catalog.json',{cache:'no-cache'}).then(r=>{if(!r.ok)throw Error('目录读取失败');return r.json()}).then(value=>{if(value.schemaVersion!==1)throw Error('目录版本不支持');catalog=value}).catch(e=>error=e.message)}})
</script>

<div id="depot-v2" aria-label="DSH Depot 插件仓">
  <header class="dv-header dv-wrap">
    <a class="dv-brand" href="index.html"><span class="dv-emblem" aria-hidden="true"><b></b><b></b><b></b><b></b></span>DSH Depot <small>插件仓</small></a>
    <nav class="dv-navigation" aria-label="网站主导航"><a href="index.html" aria-current={page==='home'?'page':undefined}>首页</a><a href="plugins.html" aria-current={page!=='home'?'page':undefined}>插件目录</a><a href="#guide" onclick={openGuide}>安装指南</a></nav>
    <div class="dv-header-end">插件离线包 <span class="dv-mono" style="margin-left:8px">/ DSH DEPOT</span></div>
  </header>
  <main>
    {#if error}
      <section class="dv-wrap dv-empty" role="alert"><h1>暂时无法读取插件目录。</h1><p>{error}</p><button class="dv-secondary" type="button" onclick={()=>location.reload()}>重新加载</button></section>
    {:else if !catalog}
      <p class="dv-wrap" style="padding-block:60px" role="status">正在读取插件目录…</p>
    {:else if page==='home'}
      <section class="dv-wrap" aria-label="插件首页">
        <div class="dv-hero">
          <div class="dv-hero-copy"><div class="dv-kicker">DSH Plugin Packages</div><h1>DSH 插件，<br>下载后安装。</h1><p>查看插件的功能、平台和版本。<br>已发布的安装包包含运行依赖。</p><div class="dv-hero-actions"><a class="dv-primary" href="plugins.html">浏览插件目录 <span aria-hidden="true">↗</span></a><button class="dv-text-link" type="button" onclick={openGuide}>如何离线安装 <span aria-hidden="true">→</span></button></div><div class="dv-caption"><span class="dv-dot"></span>已收录 {catalog.plugins.length} 个插件 · DSH {catalog.host?.version??'版本见详情'}</div></div>
          {#if feature}
            <article class="dv-feature" aria-label={`插件介绍 ${feature.name}`}><div class="dv-feature-top"><span>PLUGIN / 01</span><span>{categories[feature.category]}</span></div><div class="dv-feature-identity"><span class="dv-feature-monogram" aria-hidden="true"><PluginIcon id={feature.id}/></span><div><h2>{#if feature.id==='sidebar'}Better<br>Sidebar.{:else}{feature.name}{/if}</h2></div></div><p>{#if feature.id==='sidebar'}侧栏与导航扩展。<br>查看兼容版本、包体积和安装方式。{:else}{feature.description}{/if}</p><div class="dv-feature-file">{featuredPackage?.fileName??feature.npmName}<br>{featuredPackage?`${platforms[featuredPackage.target]} · ${bytes(featuredPackage.compressedBytes)}`:'离线包尚未公开发布'}</div><div class="dv-feature-end"><span class="dv-muted">源码 <span class="dv-mono">{(featuredPackage?.source?.commit??feature.seed?.commit)?.slice(0,7)??'详见来源'}</span></span><a class="dv-text-link" href={detailUrl(feature.id)}>了解插件 ↗</a></div></article>
          {/if}
        </div>
        <div class="dv-principles">{#each [['选择平台','按系统架构查看可下载的包。'],['本地安装','包内包含运行依赖，无需现场编译。'],['查看记录','核对版本、校验和与实际验证范围。']] as principle,i}<div class="dv-principle"><span class="dv-principle-number">0{i+1}</span><div><b>{principle[0]}</b><p>{principle[1]}</p></div></div>{/each}</div>
        <section aria-label="插件列表"><div class="dv-section-head"><div><div class="dv-kicker">Plugin packages</div><h2>插件与安装包</h2></div><a class="dv-text-link" href="plugins.html">浏览全部 {catalog.plugins.length} 个插件 →</a></div><div class="dv-recommendations">{#each catalog.plugins.slice(0,3) as p}<PluginCard plugin={p} {catalog} href={detailUrl(p.id)}/>{/each}</div><div class="dv-home-note"><span>已收录 {catalog.plugins.length} 个 · 当前可下载 {currentPackageCount} 个平台包</span><span>兼容、体积与验证范围，均可在详情中查看。</span></div></section>
      </section>
    {:else if page==='search'}
      <section class="dv-wrap" aria-label="插件搜索页面">
        <div class="dv-search-head"><div class="dv-breadcrumb"><a href="index.html">首页</a><span aria-hidden="true">/</span><span>插件目录</span></div><div class="dv-search-title"><div><div class="dv-kicker">The plugin directory</div><h1>搜索 DSH 插件</h1><p>按名称、作者或功能搜索，再选择系统平台和验证状态。</p></div><span class="dv-caption">收录插件 <span class="dv-mono">/ {String(catalog.plugins.length).padStart(2,'0')}</span></span></div><form class="dv-search-form" role="search" aria-label="搜索插件" onsubmit={e=>{e.preventDefault();filter('q',query.trim().slice(0,150))}}><label class="dv-input-wrap"><span aria-hidden="true">⌕</span><input type="search" name="query" aria-label="搜索插件关键词" placeholder="搜索插件、作者或功能…" autocomplete="off" bind:value={query}></label><button class="dv-primary" type="submit">搜索 <span aria-hidden="true">→</span></button></form></div>
        <div class="dv-search-layout">
          <aside class="dv-search-filters" aria-label="插件筛选条件">
            <div class="dv-filter-block"><span class="dv-filter-title">插件分类</span><div class="dv-category-list">{#each Object.entries(categories) as [key,label]}<button class="dv-category-button" type="button" aria-pressed={options.category===key} onclick={()=>filter('category',key)}><span>{label}</span><small>{catalog.plugins.filter(p=>key==='all'||p.category===key).length}</small></button>{/each}</div></div>
            <div class="dv-filter-block"><label class="dv-filter-title" for="depot-platform-v2">目标平台</label><select id="depot-platform-v2" class="dv-select dv-platform-filter" value={options.platform} onchange={e=>filter('platform',e.currentTarget.value)}>{#each Object.entries(platforms) as [key,label]}<option value={key}>{label}</option>{/each}</select><p class="dv-filter-note">不同平台独立构建与验证。<br>仅通过验证并发布的包可下载。</p></div>
            <div class="dv-filter-block"><span class="dv-filter-title">验证状态</span><label class="dv-check"><input type="checkbox" checked={options.verified} onchange={e=>filter('verified',e.currentTarget.checked)}><span>只看验证通过的包</span></label></div>
            <div class="dv-filter-block"><span class="dv-filter-title">当前宿主基线</span><span class="dv-mono dv-muted">DSH {catalog.host?.version??'版本见详情'}</span><p class="dv-filter-note">在详情中查看精确测试环境。</p></div>
          </aside>
          <section class="dv-results" aria-label="插件搜索结果">
            <div class="dv-result-tools"><span class="dv-result-count" aria-live="polite">找到 <strong>{items.length}</strong> 个插件</span><label class="dv-sort">排序<select class="dv-select" aria-label="结果排序" value={options.sort} onchange={e=>filter('sort',e.currentTarget.value)}><option value="curated">目录顺序</option><option value="size" disabled={!canSortSize}>包体积从小到大</option><option value="name">名称 A–Z</option></select></label></div>
            <div class="dv-chips">{#if chips.length}{#each chips as chip}<button class="dv-chip" type="button" aria-label={`移除${chip.label}筛选`} onclick={()=>remove(chip.key)}>{chip.label} <span aria-hidden="true">×</span></button>{/each}<button class="dv-muted" style="font-size:10px" type="button" onclick={reset}>清除全部</button>{:else}<span>来源、版本和验证记录见插件详情</span>{/if}</div>
            {#if items.length}<div class="dv-result-grid">{#each items as p}<PluginCard plugin={p} {catalog} target={options.platform} href={detailUrl(p.id)}/>{/each}</div>{:else}<div class="dv-empty"><div class="dv-kicker">No matching packages</div><h2>暂时没有匹配的插件。</h2><p>{options.verified?'当前条件下还没有公开发布的验证包。可以取消“只看验证通过的包”，查看插件信息。':'试试其他关键词，或调整分类、平台与验证条件。'}</p><button class="dv-secondary" type="button" onclick={reset}>清除筛选，查看全部</button></div>{/if}
            <div class="dv-result-foot"><span>{items.length?`已显示全部 ${items.length} 个插件 · 首批收录 ${catalog.plugins.length} 个`:'没有符合当前条件的结果'}</span><span class="dv-result-page" aria-label="当前第 1 页">1</span></div>
          </section>
        </div>
      </section>
    {:else if plugin}
      <section class="dv-wrap" aria-label="插件详情页面">
        <div class="dv-detail-head"><div class="dv-breadcrumb"><a href={back}>← 返回</a><span aria-hidden="true">/</span><span>{categories[plugin.category]}</span><span aria-hidden="true">/</span><span>{plugin.name}</span></div><div class="dv-detail-title"><span class="dv-plugin-mark" aria-hidden="true"><PluginIcon id={plugin.id}/></span><div><h1>{plugin.name}</h1><p><span>{plugin.repository.split('/')[0]}</span><span style="margin-inline:9px">/</span><span class="dv-mono">v{selectedPackage?.version??plugin.seed?.version??'待收录'}</span></p></div></div><p class="dv-detail-intro">{plugin.description||plugin.npmName}</p></div>
        <div class="dv-detail-layout">
          <div class="dv-detail-copy"><div class="dv-detail-tabs" role="tablist" aria-label="插件资料">{#each [['install','安装方式'],['proof','构建与验证']] as [key,label]}<button id={`depot-${key}-tab`} class="dv-detail-tab" role="tab" aria-selected={tab===key} aria-controls={`depot-${key}-panel`} tabindex={tab===key?0:-1} type="button" onclick={()=>setDetail('tab',key)} onkeydown={tabKey}>{label}</button>{/each}</div>
            <section id="depot-install-panel" role="tabpanel" aria-labelledby="depot-install-tab" hidden={tab!=='install'}><h2>安装这个插件</h2><p>下载与你的系统架构对应的离线包，由原版 DSH 完成本地安装。</p>
              {#if selectedPackage}
                <div class="dv-install-step"><span>01</span><div><h3>确认环境与安装包</h3><p>当前包对应 {platforms[target]}。已验证宿主为 DSH {selectedPackage.host.version}、Node {selectedPackage.host.node}。</p></div></div>
                <div class="dv-install-step"><span>02</span><div><h3>核对 SHA-256</h3><p>在终端中校验文件，结果应与“构建与验证”中的 SHA-256 完全一致。</p><code class="dv-code">{target==='linux-x64'?'sha256sum':'shasum -a 256'} "./{selectedPackage.fileName}"</code></div></div>
                <div class="dv-install-step"><span>03</span><div><h3>从本地安装</h3><p>将命令中的相对路径替换为你的实际包路径。</p></div></div><div class="dv-command-head"><span>安装命令</span><button type="button" class="dv-text-link" onclick={copyInstall}>{installCopied||'复制命令'}</button><span class="dv-sr-only" role="status">{installCopied}</span></div><code class="dv-code">{installCommand(selectedPackage)}</code><p>安装完成后重新启动 DSH，再查看插件是否启用。此命令安装到 web profile；使用其他 profile 时替换 <span class="dv-mono">web</span>。DSH、Node 和外部 API 凭据需要预先准备。</p>
              {:else}<div class="dv-empty" style="text-align:left;padding:24px 19px"><h2>{platforms[target]}，还在准备中。</h2><p style="margin:10px 0 0">对应平台完成构建与空缓存离线验证并发布后，这里会提供包体积、下载和安装命令。</p></div>{/if}
            </section>
            <section id="depot-proof-panel" role="tabpanel" aria-labelledby="depot-proof-tab" hidden={tab!=='proof'}><h2>构建与验证记录</h2><p>{selectedPackage?'下面是当前所选平台安装包的验证范围。平台切换后，报告与校验值对应所选包。':'当前平台尚无公开发布的验证包，不标记为验证通过。'}</p>
              <ul class="dv-proof-list">{#each [['全新缓存 · 断网安装',proof?.checks?.install],['配置合成与宿主启动',proof?.checks?.compose&&proof?.checks?.host],[proof?.checks?.registration&&!proof?.checks?.clientModule?'已声明的插件配置注册':'鉴权后的页面与模块登记',proof?.checks?.host&&(proof?.checks?.clientModule||proof?.checks?.registration)],['浏览器内完整业务功能',null],...(proof?.scope?.includes('native-load')?[['原生依赖实际加载',proof.checks.native]]:[])] as [label,passed]}<li><span>{label}</span><small style:color={!passed?'var(--depot-muted)':undefined}>{passed?'通过':label==='浏览器内完整业务功能'?'未覆盖':'暂无报告'}</small></li>{/each}</ul>
              <p>{selectedPackage?`测试环境：${platforms[target]} · DSH ${selectedPackage.host.version} · Node ${selectedPackage.host.node}。其他平台独立验证。`:'各平台独立验证，切换目标平台查看对应记录。'}</p><h3 style="font-size:13px;margin-top:22px">产物校验值</h3><code class="dv-code">{selectedPackage?.sha256??'尚未发布'}</code><p class="dv-mono">源码：<a class="dv-text-link" href={`https://github.com/${plugin.repository}/tree/${selectedPackage?.source?.commit??plugin.seed?.commit??''}`}>{plugin.repository} · {selectedPackage?.source?.commit??plugin.seed?.commit??'待确认'}</a></p>{#if downloadUrl(selectedPackage?.reportUrl)}<a class="dv-text-link" href={downloadUrl(selectedPackage.reportUrl)}>下载构建报告 ↗</a>{#if downloadUrl(selectedPackage?.assets?.checksums)}<span aria-hidden="true"> · </span><a class="dv-text-link" href={downloadUrl(selectedPackage.assets.checksums)}>下载校验清单 ↗</a>{/if}{/if}
            </section>
          </div>
          <aside class="dv-detail-side" aria-label="离线包选择"><div class="dv-kicker">Offline package</div><div class="dv-platform-choices" aria-label="详情目标平台">{#each Object.entries(platforms).filter(([key])=>key!=='all') as [key,label]}<button class="dv-platform-choice" type="button" aria-pressed={target===key} onclick={()=>setDetail('platform',key)}><span>{label}</span><small>{packagesFor(catalog,plugin.id).some(p=>p.target===key)?'验证通过':plugin.status==='needs_recipe'?'待适配':'尚未发布'}</small></button>{/each}</div><dl class="dv-detail-facts"><dt>包体积</dt><dd>{bytes(selectedPackage?.compressedBytes)}</dd><dt>兼容 DSH</dt><dd>{selectedPackage?.host?.version??catalog.host?.version??'待验证'}</dd><dt>许可证</dt><dd>{plugin.license??'待核对'}</dd></dl>{#if packageHref}<a class="dv-primary" style="width:100%;gap:12px" href={packageHref} download={selectedPackage.fileName}>下载离线包 <span aria-hidden="true">↓</span></a>{:else}<button class="dv-primary" style="width:100%;gap:12px" type="button" disabled>{plugin.status==='needs_recipe'?'待适配':'尚未发布'} <span aria-hidden="true">↓</span></button>{/if}<p class="dv-download-note">{packageHref?'已通过所选平台的离线验证。下载后请核对 SHA-256。':plugin.availabilityNote??'当前平台尚无公开发布的验证包，不能提供下载。'}</p></aside>
        </div>
      </section>
    {:else}<section class="dv-empty dv-wrap"><h1>未找到这个插件。</h1><a class="dv-text-link" href="plugins.html">返回插件目录</a></section>{/if}
    <section id="guide" class="dv-help dv-wrap" bind:this={helpPanel} hidden={!help} aria-live="polite"><button type="button" class="dv-help-close" aria-label="关闭安装指南" onclick={()=>help=false}>×</button><h2>离线安装指南</h2><p>先在有网络的设备上下载 .tgz，再将文件复制到安装设备。安装过程可以离线完成；调用外部模型或 API 的功能仍需要网络和对应账号。</p>
      <ol class="dv-guide-steps"><li><h3>确认 DSH 版本与系统架构</h3><p>确认 DSH、Node 和 pnpm 已在安装设备上准备好。运行 <code>dsh --version</code>、<code>node --version</code> 和 <code>pnpm --version</code>；DSH、Node 与详情中的测试环境比较，测试安装使用 pnpm 11.25.0。macOS 可用 <code>uname -m</code> 查看架构；arm64 包不能用于 Intel Mac。当前尚无通过验证的 Windows 包。</p></li><li><h3>下载并核对文件</h3><p>在详情中选择平台，下载对应的 .tgz。不要解压，也不要将网页另存为 .tgz。macOS 使用 <code>shasum -a 256 "./文件名.tgz"</code>，Linux 使用 <code>sha256sum "./文件名.tgz"</code>；与详情中的 SHA-256 对照，不一致时重新下载。</p></li><li><h3>执行本地安装命令</h3><p>先关闭正在运行的 DSH，再复制详情中的安装命令，将文件路径改为实际路径。命令中的 <code>--profile web</code> 指定目标 profile；文件名包含空格时保留引号。不要把 GitHub 网页地址粘贴为安装路径。</p></li><li><h3>启动并检查插件</h3><p>用原来的方式启动 DSH，检查插件页面或设置。安装成功不代表外部服务已配置；模型接入、余额查询等功能可能还需要 API Key、账号和网络。</p></li></ol>
      <details class="dv-guide-trouble"><summary>下载或安装失败时</summary><p><strong>下载 404：</strong>刷新详情后重试，也可进入 <a class="dv-text-link" href="https://github.com/fatevase/dsh_depot/releases">GitHub Releases</a> 查找同名文件。<strong>找不到文件：</strong>确认终端当前目录，或改用完整路径。<strong>离线依赖缺失：</strong>检查文件完整性与宿主版本；如仍失败，记录包名、系统、DSH 版本和完整报错。<strong>插件未启用：</strong>确认安装的 profile 与启动使用的一致，再查看 DSH 的启动日志。</p></details></section>
  </main>
  <footer class="dv-footer dv-wrap"><span class="dv-footer-brand">DSH Depot <span class="dv-muted" style="font-size:10px;margin-left:10px">DSH 插件离线分发</span></span><span>{catalog?.lastSuccessfulDiscoveryAt?`最近成功检查：${new Date(catalog.lastSuccessfulDiscoveryAt).toLocaleString('zh-CN')}`:'尚未完成来源检查'}</span></footer>
</div>
