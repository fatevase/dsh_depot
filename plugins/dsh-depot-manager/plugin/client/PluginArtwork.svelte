<script>
 let {item,size=36}=$props(),failed=$state(false)
 const source=$derived(typeof item.meta?.icon==='string'&&/^(https?:\/\/|\/|data:image\/)/.test(item.meta.icon)?item.meta.icon:null)
 const terminal=$derived(/(?:shell|terminal)/i.test(item.moduleName??item.name))
</script>
{#if source&&!failed}<img class="plugin-image" src={source} width={size} height={size} alt="" onerror={()=>failed=true}/>
{:else}<svg width={size} height={size} viewBox="0 0 36 36" fill="none" aria-hidden="true">
 {#if terminal}<path d="m10 11 6.6 6.6L10 24.5m10.1 0h6.8" stroke="#679efe" stroke-width="3.5"/>
 {:else}<rect x="8" y="8" width="13" height="13" rx="3" fill="#679efe"/><rect x="15" y="15" width="13" height="13" rx="3" fill="#54d5c6" fill-opacity=".85"/>{/if}
</svg>{/if}
