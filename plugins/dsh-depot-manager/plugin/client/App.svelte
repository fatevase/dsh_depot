<script>
 import {onMount} from 'svelte'
 import ImportPanel from './ImportPanel.svelte'
 import InstalledPanel from './InstalledPanel.svelte'
 import PluginDetail from './PluginDetail.svelte'
 import Modal from './Modal.svelte'
 import OperationsPanel from './OperationsPanel.svelte'
 import {MANAGER_VERSION} from '../../contracts/constants.mjs'
 import {emptyState,reduceManagerState,stateLabel} from './state.mjs'
 import {pluginTitle} from './view.mjs'
 import {prepareImports,installPrepared} from './import-flow.mjs'
 let {client,initialState=emptyState()}=$props()
 let state=$state(initialState),busy=$state(false),error=$state(''),notice=$state(''),dialog=$state(null),prepared=$state([]),preparing=$state(false),loadError=$state(''),loadPhase=$state('prepare'),loadResults=$state([])
 let preparation=0,alive=true,refreshing=$state(false)
 const selected=$derived(state.installed.find(x=>x.name===state.selection))
 const dispatch=event=>state=reduceManagerState(state,event)
 async function refresh(){if(refreshing)return;refreshing=true;try{const [host,installed,operations,exports]=await Promise.all([client.current(),client.installed(),client.operations(),client.exports?.()??[]]);if(!alive)return;dispatch({type:'host',value:host});dispatch({type:'installed',value:installed});dispatch({type:'operations',value:operations});dispatch({type:'exports',value:exports})}finally{refreshing=false}}
 async function act(fn){if(busy)return;busy=true;error='';try{await fn()}catch(e){error=`${e.code??'操作失败'}：${e.message}`}finally{busy=false}}
 function close(){dialog=null;preparation++;preparing=false}
 function openLoad(){if(busy){dialog='load';return}preparation++;prepared=[];loadResults=[];loadError='';loadPhase='prepare';dialog='load'}
 async function importGroups(groups,e){if(e){loadError=e.message;return}const generation=++preparation;preparing=true;loadError='';prepared=[];try{const items=await prepareImports(client,groups,items=>{if(generation===preparation)prepared=items});if(generation===preparation)prepared=items}catch(e){if(generation===preparation)loadError=e.message}finally{if(generation===preparation)preparing=false}}
 async function confirmLoad(){if(busy||preparing)return;busy=true;loadError='';loadPhase='installing';try{loadResults=await installPrepared(client,prepared,op=>dispatch({type:'operation',value:op}));loadPhase='done';await refresh()}catch(e){loadError=`${e.code??'载入未完成'}：${e.message}`;loadPhase='prepare'}finally{busy=false}}
 async function exportPlugin(item){await act(async()=>{await client.createExport({packageName:item.name,installedFingerprint:item.fingerprint});await refresh()})}
 function navigate(name){state.selection=name;if(typeof window!=='undefined')location.hash=name?'plugin='+encodeURIComponent(name):''}
 onMount(()=>{if(!client)return;const route=()=>{const value=location.hash.slice(1);state.selection=value.startsWith('plugin=')?new URLSearchParams(value).get('plugin'):null};route();window.addEventListener('hashchange',route);refresh().catch(e=>error=e.message);const timer=setInterval(()=>refresh().catch(()=>dispatch({type:'connection',value:'disconnected'})),2500);return()=>{alive=false;clearInterval(timer);window.removeEventListener('hashchange',route)}})
</script>
<svelte:head><title>{selected?pluginTitle(selected)+' · ':''}插件 · DSH</title></svelte:head>
<main class="manager-page">
 {#if selected}<PluginDetail item={selected} host={state.host} exports={state.exports.filter(x=>x.packageName===selected.name)} {busy} onback={()=>navigate(null)} onexport={exportPlugin} oncancel={id=>act(async()=>{await client.cancelExport(id);await refresh()})}/>
 {:else}<header class="page-head"><div><h1>插件</h1><p class="page-intro">载入和导出离线插件 <span title="在当前 DSH 环境中载入和导出离线插件">ⓘ</span></p></div><div class="toolbar"><button class="icon-button refresh-button" aria-label="刷新插件" disabled={refreshing||busy} onclick={()=>refresh().catch(e=>error=e.message)}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2 6M20 4v7h-7"/></svg></button><button class="load-button" disabled={busy&&loadPhase!=='installing'} onclick={openLoad}><span aria-hidden="true">＋</span> 载入插件</button></div></header>{/if}
 {#if error}<p class="notice error" role="alert">{error}<button class="icon-button" aria-label="关闭错误" onclick={()=>error=''}>×</button></p>{/if}
 {#if notice}<p class="notice" role="status">{notice}<button class="icon-button" aria-label="关闭提示" onclick={()=>notice=''}>×</button></p>{/if}
 {#if state.connection==='disconnected'}<p class="notice warning-text" role="status">连接已断开，正在重新连接 DSH。显示的是上次读取的状态。</p>{/if}
 {#if !selected}<InstalledPanel items={state.installed} onopen={item=>navigate(item.name)}/>{/if}
 <footer class="page-footer"><a href="/">返回 DSH</a><span>离线插件管理器 {MANAGER_VERSION}</span><button class="text-button" onclick={()=>dialog='tasks'}>操作记录{#if state.operations.some(o=>['applying','queued','awaiting_reload','waiting_for_host_exit'].includes(o.state))}<span class="status-dot"></span>{/if}</button></footer>
</main>
{#if dialog==='load'}<Modal title="载入插件" onclose={close}>
 {#if loadPhase==='prepare'}<ImportPanel onimport={importGroups} busy={preparing||busy}/>{#if preparing}<p class="subtle" role="status">正在准备插件…</p>{/if}
 {#each prepared as item}<article class="prepared-item"><div class="list-row"><strong>{item.packageName}</strong><span class="subtle">{item.version??''}</span></div><p class="subtle">{item.target??'未声明平台'} · {item.blockers?.length?'无法载入':'已准备好'}</p>{#each item.warnings??[] as warning}<p class="warning-text">{warning.message??warning.code}</p>{/each}{#each item.blockers??[] as blocker}<p class="error">{blocker.message??blocker.code}</p>{/each}</article>{/each}
 {#if prepared.length&&!prepared.some(i=>i.blockers?.length)}<p class="subtle">点击“确定”将安装以上插件；同名插件会被替换。请确认离线包来源可信。</p>{/if}
 {:else if loadPhase==='installing'}<div class="loading-state" role="status"><span class="spinner"></span><h3>正在载入插件</h3><p class="subtle">关闭窗口后任务仍会继续，可在操作记录中查看。</p></div>
 {:else}<div class="load-result">{#each loadResults as op}<p class:error={op.state==='failed'}><strong>{op.result?.packageName??'插件'}</strong> · {stateLabel(op.state)}</p>{#if op.error}<p class="error">{op.error.message}</p>{/if}{/each}<p class="subtle">等待加载的插件将在 DSH 重新加载或重启后生效。</p></div>{/if}
 {#if loadError}<p role="alert" class="error notice">{loadError}</p>{/if}
 {#snippet footer()}{#if loadPhase==='prepare'}<button class="secondary" onclick={close}>取消</button><button disabled={busy||preparing||!prepared.length||prepared.some(i=>i.blockers?.length)} onclick={confirmLoad}>确定</button>{:else}<button onclick={close}>关闭</button>{/if}{/snippet}
 </Modal>
{:else if dialog==='tasks'}<Modal title="操作记录" onclose={close}><OperationsPanel items={state.operations} oncancel={id=>act(async()=>{await client.cancel(id);await refresh()})}/>{#if state.host?.capabilities?.toolkitEntry}<details class="maintenance-entry"><summary>外部维护入口</summary><p class="subtle">{state.host.capabilities.toolkitEntry}</p></details>{/if}</Modal>{/if}
