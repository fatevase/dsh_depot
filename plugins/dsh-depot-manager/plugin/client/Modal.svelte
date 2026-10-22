<script>
 let {title,onclose=()=>{},children,footer}=$props()
 function show(node){node.showModal();return{destroy(){node.close()}}}
</script>
<dialog class="modal" use:show aria-label={title} oncancel={e=>{e.preventDefault();onclose()}} onclick={e=>{if(e.target===e.currentTarget){const r=e.currentTarget.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)onclose()}}}>
 <div class="modal-head"><h2>{title}</h2><button class="icon-button close-button" aria-label="关闭弹窗" onclick={onclose}>×</button></div>
 <div class="modal-body">{@render children?.()}</div>
 {#if footer}<div class="modal-footer">{@render footer()}</div>{/if}
</dialog>
