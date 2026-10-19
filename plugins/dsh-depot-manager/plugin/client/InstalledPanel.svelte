<script>let {items=[],onremove=()=>{},busy=false}=$props()</script>
<section class="panel"><div class="section-title"><span class="number">03</span><h2>已安装插件</h2><span class="subtle">{items.length} 项</span></div><p class="subtle">卸载只移除插件，保留配置与业务数据。内置插件与管理器本身受保护。</p>
 {#if !items.length}<p class="empty">尚未读取到插件。</p>{/if}
 {#each items as item (item.name)}<div class="list-row"><div><strong>{item.name}</strong><small>{item.version??'未知版本'} · {item.enabled?'已启用':'未启用'}</small></div>{#if item.protected}<span class="badge neutral">受保护</span>{:else}<button class="secondary" disabled={busy} onclick={()=>onremove(item)}>卸载</button>{/if}</div>{/each}
</section>
