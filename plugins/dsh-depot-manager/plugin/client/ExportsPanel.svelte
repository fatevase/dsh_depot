<script>
 import {exportStateLabel} from './state.mjs'
 let {items=[],oncancel=()=>{},busy=false}=$props()
 const running=state=>['queued','collecting','packing','checking'].includes(state)
 const size=bytes=>bytes>=1048576?`${(bytes/1048576).toFixed(1)} MiB`:`${Math.ceil(bytes/1024)} KiB`
</script>
<section class="panel" aria-label="导出记录"><p class="subtle">下载保留 24 小时。</p>
 {#if !items.length}<p class="empty">点击上方“导出插件”开始打包。</p>{/if}
 {#each items as item (item.exportId)}<article class="operation"><div class="list-row"><strong>{item.packageName} <small>{item.version??''}</small></strong><span class="badge" class:warning={item.state==='failed'}>{exportStateLabel(item.state)}</span></div>
 {#if item.progress&&running(item.state)}<p>已收集 {item.progress.files??0} / {item.progress.totalFiles??'—'} 项</p>{/if}
 {#if running(item.state)}<button class="secondary" disabled={busy} onclick={()=>oncancel(item.exportId)}>取消导出</button>{/if}
 {#if item.error}<p class="error">{item.error.code} · {item.error.message}</p>{/if}
 {#if item.state==='ready'}<p class="warning-text">本机导出，目标环境尚未验证。</p><p>{item.fileName} · {size(item.compressedBytes)}</p><p class="digest">SHA-256 <code>{item.sha256}</code></p>{#each item.warnings??[] as warning}<p class="warning-text">{warning.message??warning.code}</p>{/each}{#if item.exclusions?.length}<details><summary>已排除 {item.exclusions.length} 项配置或缓存</summary>{#each item.exclusions.slice(0,20) as excluded}<p>{excluded.path}</p>{/each}{#if item.exclusions.length>20}<p>完整清单在包内 depot-manifest.json 中。</p>{/if}</details>{/if}<a class="download-button" href={item.downloadUrl} download={item.fileName}>下载离线包</a>{/if}
 </article>{/each}
</section>
