<script>
 import {onMount} from 'svelte'
 import ImportPanel from './ImportPanel.svelte'
 import InstalledPanel from './InstalledPanel.svelte'
 import OperationsPanel from './OperationsPanel.svelte'
 import {emptyState, reduceManagerState} from './state.mjs'

 let {client, initialState = emptyState()} = $props()
 let state = $state(initialState)
 let busy = $state(false)
 let progress = $state('')
 let error = $state('')
 let feedback = $state('')
 let selection = $state(null)
 let accepted = $state(false)
 let dialog = $state()
 let alive = true
 let refreshing = false
 const visiblePlugins = $derived(state.installed.filter(item => item.installed !== false && !item.name.startsWith('@deepseek-ai/')))
 const dispatch = event => { if (alive) state = reduceManagerState(state, event) }

 async function refresh() {
  if (refreshing) return
  refreshing = true
  try {
   const [host, installed, operations] = await Promise.all([client.current(), client.installed(), client.operations()])
   dispatch({type: 'host', value: host})
   dispatch({type: 'installed', value: installed})
   dispatch({type: 'operations', value: operations})
  } finally { refreshing = false }
 }

 async function act(fn) {
  if (busy) return
  busy = true
  error = ''
  feedback = ''
  try { await fn() } catch (e) { error = e.message }
  finally { busy = false; progress = '' }
 }

 async function importGroups(groups, failure) {
  if (failure) { error = failure.message; return }
  await act(async () => {
   if (groups.length > 20) throw new Error('一次最多选择 20 个安装包')
   for (const files of groups) {
    progress = `正在检查 ${files[0]?.file.name ?? '安装包'}…`
    try { dispatch({type: 'import', value: await client.importFiles(files)}) }
    catch (e) {
     dispatch({type: 'import', value: {
      importId: crypto.randomUUID(), packageName: files[0]?.file.name ?? '安装包',
      blockers: [{code: e.code, message: e.message}], warnings: [], checks: {},
     }})
    }
   }
  })
 }

 function confirm(action, item) {
  error = ''
  accepted = false
  selection = {action, item}
 }

 async function execute() {
  const request = selection
  await act(async () => {
   const removing = request.action === 'remove'
   progress = removing ? '正在卸载…' : '正在安装…'
   const plan = await client.plan(removing
    ? {action: 'remove', packageName: request.item.name, installedFingerprint: request.item.fingerprint}
    : {action: 'install', importId: request.item.importId, acceptUnverified: accepted})
   const operation = await client.start(plan.planId)
   dispatch({type: 'operation', value: operation})
   selection = null
   if (operation.error) error = operation.error.message
   else {
    feedback = removing
     ? `已卸载 ${request.item.name}，配置和数据已保留。`
     : `${plan.packageName} ${plan.version} 已安装，重启 DSH 后生效。`
    if (!removing) dispatch({type: 'dismiss-import', importId: request.item.importId})
   }
   await refresh()
  })
 }

 $effect(() => {
  if (!dialog) return
  if (selection && !dialog.open) dialog.showModal()
  if (!selection && dialog.open) dialog.close()
 })

 onMount(() => {
  alive = true
  refresh().catch(e => { error = e.message })
  const timer = setInterval(() => refresh().catch(() => dispatch({type: 'connection', value: 'disconnected'})), 2500)
  return () => { alive = false; clearInterval(timer) }
 })
</script>

<div class="depot-settings" aria-busy={busy}>
 <h2>本地插件</h2>
 <ImportPanel onimport={importGroups} busy={busy || state.connection !== 'connected'} />

 <div class="depot-status" aria-live="polite">
  {#if progress}<p class="depot-muted">{progress}</p>{/if}
  {#if feedback}<p>{feedback}</p>{/if}
  {#if error}<p class="depot-error" role="alert">{error}</p>{/if}
  {#if state.connection === 'disconnected'}
   <p class="depot-error">连接已断开。<button class="depot-link" onclick={() => act(refresh)}>重新连接</button></p>
  {/if}
 </div>

 {#if state.imports.length}
  <section class="depot-pending" aria-label="待安装">
   {#each state.imports as item (item.importId)}
    <div class="depot-import">
     <div class="depot-row">
      <div class="depot-identity"><strong>{item.packageName}</strong>{#if item.version}<span class="depot-muted">{item.version}</span>{/if}</div>
      <div class="depot-actions">
       <button class="depot-button depot-primary depot-small" disabled={busy || !!item.blockers?.length} onclick={() => confirm('install', item)}>
        {visiblePlugins.some(p => p.name === item.packageName) ? '替换' : '安装'}
       </button>
       <button class="depot-icon-button" aria-label={`移除待安装项 ${item.packageName}`} disabled={busy} onclick={() => dispatch({type: 'dismiss-import', importId: item.importId})}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>
       </button>
      </div>
     </div>
     {#each item.blockers ?? [] as blocker}<p class="depot-error">{blocker.message}</p>{/each}
    </div>
   {/each}
  </section>
 {/if}

 <InstalledPanel items={visiblePlugins} onremove={item => confirm('remove', item)} {busy} loading={state.connection === 'connecting'} />

 {#if state.operations.length}
  <details class="depot-history">
   <summary>操作记录 <span class="depot-muted">{state.operations.length}</span></summary>
   <OperationsPanel items={state.operations} oncancel={id => act(() => client.cancel(id))} />
  </details>
 {/if}

 <dialog class="depot-confirm" bind:this={dialog} aria-labelledby="depot-confirm-title" onclose={() => { selection = null }} oncancel={event => { if (busy) event.preventDefault(); else selection = null }}>
  {#if selection}
   {@const removing = selection.action === 'remove'}
   <h3 id="depot-confirm-title">{removing ? '卸载插件' : '安装插件'}</h3>
   <p class="depot-confirm-name">{removing ? selection.item.name : selection.item.packageName}</p>
   {#if selection.item.version}<p class="depot-muted">{selection.item.version}</p>{/if}
   {#if removing}
    <p>卸载后保留插件的配置和数据。</p>
   {:else}
    {#if visiblePlugins.some(p => p.name === selection.item.packageName)}<p>当前已安装的版本将被替换。</p>{/if}
    {#if selection.item.warnings?.length}
     <details class="depot-checks"><summary>安装包检查结果</summary>{#each selection.item.warnings as warning}<p>{warning.message}</p>{/each}</details>
     <label class="depot-trust"><input type="checkbox" bind:checked={accepted} />我已了解检查结果，信任此安装包</label>
    {/if}
   {/if}
   {#if error}<p role="alert" class="depot-error">{error}</p>{/if}
   <div class="depot-confirm-actions">
    <button class="depot-button depot-outline" disabled={busy} onclick={() => { selection = null }}>取消</button>
    <button class="depot-button" class:depot-danger={removing} class:depot-primary={!removing} disabled={busy || (!removing && !!selection.item.warnings?.length && !accepted)} onclick={execute}>
     {busy ? progress : removing ? '卸载' : '安装'}
    </button>
   </div>
  {/if}
 </dialog>
</div>
