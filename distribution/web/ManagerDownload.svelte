<script>
 import {onMount} from 'svelte'
 let {initialCatalog=null}=$props(),catalog=$state(initialCatalog),target=$state('macos-arm64'),flavor=$state('full'),error=$state('')
 const names={'macos-arm64':'macOS · Apple Silicon','linux-x64':'Linux · x64','win32-x64':'Windows · x64'}
 const valid=p=>p.verification?.status==='passed'&&p.target===target&&p.flavor===flavor&&/^[a-f0-9]{64}$/.test(p.sha256??'')&&/^https:\/\/github\.com\/fatevase\/dsh_depot\/releases\/download\//.test(p.packageUrl??'')
 let selected=$derived(catalog?.packages?.find(valid))
 onMount(()=>{if(catalog)return;fetch('manager-catalog.json').then(r=>{if(!r.ok)throw new Error('目录尚未就绪');return r.json()}).then(c=>{if(c.schemaVersion!==1)throw new Error('目录格式不受支持');catalog=c}).catch(e=>error=e.message)})
</script>
<section class="dv-guide"><div class="dv-guide-header"><span class="dv-kicker">DSH DEPOT MANAGER</span><h1>离线插件管理器</h1><p>拖入成品包，检查后安装。查看本机插件、操作记录和恢复点。</p></div>
 <div class="dv-guide-body"><label>系统 <select aria-label="管理器平台" bind:value={target}>{#each Object.entries(names) as [id,label]}<option value={id}>{label}</option>{/each}</select></label>
 <div class="dv-guide-trouble"><label><input type="radio" bind:group={flavor} value="full"/> 完整包</label><p>附带独立 Node 26.9.0，适合未准备 Node 的设备。DSH 仍需预先安装。</p><label><input type="radio" bind:group={flavor} value="lite"/> 轻量包</label><p>使用设备已有的 Node：^22.19.0 或 ≥24.0.0。缺少时停止，不会联网补装。</p></div>
 {#if selected}<div><a class="dv-button" href={selected.packageUrl}>下载{flavor==='full'?'完整包':'轻量包'}</a><p>{selected.fileName} · {(selected.compressedBytes/1024/1024).toFixed(2)} MB</p><p>SHA-256 <code>{selected.sha256}</code></p><p>已通过报告所列验收；请核对测试宿主版本与首次启动条件。</p></div>{:else}<p role="status">{error||`尚未提供 ${names[target]} ${flavor==='full'?'完整包':'轻量包'}的已验收下载。`}</p>{/if}
 <p>首次安装使用脚本菜单。管理页面固定当前 DSH 环境，卸载默认保留配置与业务数据；官方桌面版能力未验证时会阻止修改。</p><a class="dv-text-link" href="guide.html#manager">查看三平台安装、恢复与卸载指南 →</a>
 </div></section>
