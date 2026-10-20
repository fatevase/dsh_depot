<script>let {items=[],onremove=()=>{},onexport=()=>{},busy=false}=$props()</script>
<section class="panel"><div class="section-title"><span class="number">03</span><h2>已安装插件</h2><span class="subtle">{items.length} 项</span></div><p class="subtle">导出程序与运行依赖，配置留在原机。卸载保留配置与业务数据；内置插件与管理器本身不可在此卸载。</p>
 {#if !items.length}<p class="empty">尚未读取到插件。</p>{/if}
 {#each items as item (item.name)}<div class="list-row installed-row"><div><strong>{item.name}</strong><small>{item.version??'未知版本'} · {item.enabled?'已启用':'未启用'}</small>{#if item.exportReason}<small>{item.exportReason}</small>{/if}</div><div class="actions"><button class="secondary" disabled={busy||!item.exportable} title={item.exportReason??'打包当前安装的程序及运行依赖'} onclick={()=>onexport(item)}>导出离线包</button>{#if item.protected}<span class="badge neutral">受保护</span>{:else}<button class="secondary" disabled={busy} onclick={()=>onremove(item)}>卸载</button>{/if}</div></div>{/each}
</section>
