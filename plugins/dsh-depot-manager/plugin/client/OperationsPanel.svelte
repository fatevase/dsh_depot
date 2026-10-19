<script>
 import {stateLabel} from './state.mjs'
 let {items = [], oncancel = () => {}} = $props()
 const label = operation => operation.result?.removed && operation.state === 'succeeded' ? '已卸载' : stateLabel(operation.state)
</script>

<ul class="depot-operation-list">
 {#each [...items].sort((a, b) => b.updatedAt - a.updatedAt) as operation (operation.operationId)}
  <li>
   <div class="depot-row">
    <span>{operation.result?.packageName ?? '插件操作'}</span>
    <span class="depot-muted">{label(operation)}</span>
   </div>
   {#if operation.error}<p class="depot-error">{operation.error.message}</p>{/if}
   {#if ['waiting_for_host_exit', 'recovery_required'].includes(operation.state)}<p class="depot-muted">请从外部安装脚本继续此操作。</p>{/if}
   {#if ['applying', 'backing_up', 'queued'].includes(operation.state)}<button class="depot-button depot-outline depot-small" onclick={() => oncancel(operation.operationId)}>取消操作</button>{/if}
  </li>
 {/each}
</ul>
