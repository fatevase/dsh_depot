<script>
 let {items = [], onremove = () => {}, busy = false, loading = false} = $props()
</script>

<section class="depot-installed" aria-labelledby="depot-installed-heading">
 <div class="depot-section-heading"><h3 id="depot-installed-heading">已安装</h3><span class="depot-muted">{items.length}</span></div>
 {#if !items.length}<p class="depot-muted">{loading ? '正在读取插件…' : '暂无本地插件'}</p>{/if}
 <ul class="depot-plugin-list">
  {#each items as item (item.name)}
   <li class="depot-row">
    <div class="depot-identity"><strong>{item.name}</strong><span class="depot-muted">{item.version ?? '未知版本'}</span></div>
    <div class="depot-actions">
     <span class="depot-plugin-state">{item.problem ? '需要检查' : item.enabled ? '已启用' : '未启用'}</span>
     {#if item.protected}<span class="depot-protected depot-muted">{item.name === 'dsh-depot-manager' ? '当前管理器' : '内置'}</span>
     {:else}<button class="depot-button depot-outline depot-small" disabled={busy} onclick={() => onremove(item)}>卸载</button>{/if}
    </div>
   </li>
  {/each}
 </ul>
</section>
