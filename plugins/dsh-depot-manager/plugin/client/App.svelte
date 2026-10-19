<script>
 import {onMount} from 'svelte'
 import ImportPanel from './ImportPanel.svelte'
 import InstalledPanel from './InstalledPanel.svelte'
 import OperationsPanel from './OperationsPanel.svelte'
 import {emptyState,reduceManagerState} from './state.mjs'
 let {client,initialState=emptyState()}=$props(),state=$state(initialState),busy=$state(false),error=$state(''),plan=$state(null),accepted=$state(false)
 const dispatch=event=>state=reduceManagerState(state,event)
 async function refresh(){const [host,installed,operations]=await Promise.all([client.current(),client.installed(),client.operations()]);dispatch({type:'host',value:host});dispatch({type:'installed',value:installed});dispatch({type:'operations',value:operations})}
 async function act(fn){busy=true;error='';try{await fn()}catch(e){error=`${e.code??'操作失败'}：${e.message}`}finally{busy=false}}
 async function importGroups(groups,e){if(e){error=e.message;return}await act(async()=>{if(groups.length>20)throw new Error('每批最多 20 项');for(const files of groups){try{dispatch({type:'import',value:await client.importFiles(files)})}catch(e){dispatch({type:'import',value:{importId:crypto.randomUUID(),packageName:files[0]?.file.name??'导入项',blockers:[{code:e.code,message:e.message}],warnings:[],checks:{}}})}}})}
 async function preview(item){await act(async()=>{plan=await client.plan({action:'install',importId:item.importId,acceptUnverified:accepted})})}
 async function remove(item){await act(async()=>{plan=await client.plan({action:'remove',packageName:item.name,installedFingerprint:item.fingerprint})})}
 async function execute(){await act(async()=>{dispatch({type:'operation',value:await (plan.batchId?client.startBatch(plan.batchId):client.start(plan.planId))});plan=null;await refresh()})}
 onMount(()=>{if(!client)return;refresh().catch(e=>error=e.message);const timer=setInterval(()=>refresh().catch(()=>dispatch({type:'connection',value:'disconnected'})),2500);return()=>clearInterval(timer)})
</script>
<svelte:head><title>离线插件 · DSH</title></svelte:head>
<div class="manager-shell"><header><a class="back" href="/">← 返回 DSH</a><div class="brand">DSH <span>/</span> 离线插件</div><span class="connection">{state.connection==='connected'?'已连接当前宿主':'正在读取宿主状态'}</span></header>
 <main><div class="intro"><div><span class="eyebrow">LOCAL PLUGIN MANAGER</span><h1>本机插件，有序管理。</h1><p>检查离线包，确认环境，再安装。每一步都留下可查看的记录。</p></div><span class="version">v0.1.0</span></div>
 <section class="environment" aria-label="当前环境"><div><span class="eyebrow">当前环境</span><strong>{state.host?.profileName??'正在读取'}</strong></div><div><span>宿主</span><strong>{state.host?.kind??'—'} {state.host?.version??''}</strong></div><div><span>平台 / 运行时</span><strong>{state.host?.runtimeTarget??'—'} · Node {state.host?.runtime?.node??'—'}</strong></div><span class="badge neutral">仅管理此环境</span></section>
 {#if error}<p role="alert" class="error notice">{error}</p>{/if}
 <div class="workspace"><div class="primary"><ImportPanel onimport={importGroups} {busy}/>
 <section class="panel"><div class="section-title"><span class="number">02</span><h2>安装预览</h2></div>{#if state.imports.filter(i=>!i.blockers?.length).length>1}<button class="secondary" disabled={busy} onclick={()=>act(async()=>{plan=await client.batchPlan({importIds:state.imports.filter(i=>!i.blockers?.length).map(i=>i.importId),acceptUnverified:accepted})})}>批量预览 {state.imports.filter(i=>!i.blockers?.length).length} 项</button>{/if}{#if !state.imports.length}<p class="empty">导入后查看插件版本、完整性与验证状态。</p>{/if}
 {#each state.imports as item (item.importId)}<article class="import-row"><div class="list-row"><strong>{item.packageName} <small>{item.version??''}</small></strong><span class="badge" class:warning={!item.checks?.publication}>{item.blockers?.length?'已阻止':item.checks?.publication?'有对应验证证据':'未验证包'}</span></div><p class="subtle">{item.target??'未声明平台'} · 文件完整性：{item.checks?.integrity?'已核对':'未提供包内清单'}</p>{#each item.warnings??[] as warning}<p class="warning-text">{warning.code} {warning.message??''}</p>{/each}{#each item.blockers??[] as blocker}<p class="error">{blocker.code} {blocker.message??''}</p>{/each}<button class="secondary" disabled={busy||!!item.blockers?.length} onclick={()=>preview(item)}>查看变更</button></article>{/each}
 {#if state.imports.some(x=>x.warnings?.length)}<label class="accept"><input type="checkbox" bind:checked={accepted}/>我已了解未验证条件，允许尝试可检查的包</label>{/if}
 {#if plan}<div class="plan"><h3>确认{plan.batchId?'批量安装':plan.action==='remove'?'卸载':plan.action==='replace'?'替换':'安装'} {plan.packageName??''}</h3>{#each plan.items??[] as item}<p>{item.packageName} · {item.version}</p>{/each}<p>目标：{state.host?.profileName} · {plan.previousVersion??'未安装'} → {plan.version??'移除'}</p><p>操作前备份依赖与配置。{plan.action==='remove'?'保留用户数据。':''}</p>{#if plan.requiresExit}<p class="warning-text">此宿主需退出后执行。确认后保存任务，再运行外部脚本继续。</p>{/if}<div class="actions"><button disabled={busy} onclick={execute}>确认并保存任务</button><button class="secondary" onclick={()=>plan=null}>取消预览</button></div></div>{/if}
 </section><InstalledPanel items={state.installed} onremove={remove} {busy}/></div><aside><OperationsPanel items={state.operations} oncancel={id=>act(()=>client.cancel(id))}/><div class="help"><strong>遇到中断时</strong>{#if state.host?.capabilities?.toolkitEntry}<p>外部维护入口：<code style="overflow-wrap:anywhere">{state.host.capabilities.toolkitEntry}</code></p>{:else}<p>尚未注册维护工具，请先运行安装脚本。</p>{/if}<p>退出 DSH 后重跑安装脚本，查看任务与恢复点。等待加载不代表失败；不要反复安装同一份包。</p></div></aside></div>
 </main><footer>运行依赖来自离线包；插件的在线业务功能仍可能需要网络。</footer></div>
