<script>
  import {bytes,platforms,downloadUrl} from './catalog.mjs'
  import {loadRecord} from './record-client.mjs'
  let {trial,target,active=true}=$props()
  let record=$state(null),error=$state(''),retry=$state(0)
  let summary=$derived(trial.results[target])
  let result=$derived(record?.result??summary)
  $effect(()=>{
    const current=trial,platform=target,url=summary?.recordUrl,attempt=retry
    record=null;error=''
    if(!active||!url)return
    const controller=new AbortController()
    loadRecord(url,{signal:controller.signal}).then(value=>{
      if(value.kind!=='candidate'||value.repositoryId!==current.repositoryId||value.repository!==current.repository||value.sourceCommit!==current.commit||value.target!==platform)throw Error('构建记录与当前插件不匹配')
      record=value
    }).catch(e=>{if(!controller.signal.aborted)error=e.message})
    return ()=>controller.abort()
  })
</script>
{#if result}
  <div class="dv-doc-note" class:dv-doc-warning={result.status!=='compiled'}>
    <strong>{platforms[target]} · {result.status==='compiled'?'已构建 · 未离线验证':result.status==='failed'?'构建失败':'未收到构建结果'}</strong>
    {#if result.status==='compiled'}<p>已完成编译打包或成品检查，尚未完成离线安装验证。</p>{:else if result.error}<details open><summary>失败原因 · {result.errorCategory??'构建'}</summary><pre class="dv-code" style="white-space:pre-wrap;max-height:280px;overflow:auto">{result.error}</pre></details>{/if}
    {#if error}<p role="alert">{error} <button class="dv-text-link" onclick={()=>retry++}>重试</button></p>{:else if summary?.recordUrl&&!record}<p role="status">正在读取构建记录…</p>{/if}
    {#if result.warnings?.length}<details><summary>构建警告 · {result.warnings.length}</summary><ul>{#each result.warnings as warning}<li>{warning}</li>{/each}</ul></details>{/if}
  </div>
  {#if record||!summary?.recordUrl}
    <dl class="dv-facts"><div><dt>批次</dt><dd>{record?.runId??'历史记录'}{record?.runAttempt?` / ${record.runAttempt}`:''}</dd></div><div><dt>开始时间</dt><dd>{result.startedAt?new Date(result.startedAt).toLocaleString('zh-CN'):'未记录'}</dd></div><div><dt>耗时</dt><dd>{Number.isFinite(result.seconds)?`${result.seconds.toFixed(2)} 秒`:'未记录'}</dd></div><div><dt>依赖处理</dt><dd>{result.dependencyMode??'未执行'}</dd></div></dl>
    {#if result.steps?.length}
      <h3>构建步骤</h3><ol class="dv-verification-steps">{#each result.steps as step}<li><div><h3>{step.stage}</h3><code class="dv-code" style="white-space:pre-wrap;overflow-wrap:anywhere">{step.argv?.join(' ')}</code><p>{step.cwd?`目录 ${step.cwd} · `:''}{Number.isFinite(step.seconds)?`${step.seconds.toFixed(2)} 秒`:'耗时未记录'} · 退出码 {step.exitCode??'未记录'}</p></div><span class="dv-check-result" class:dv-check-passed={step.exitCode===0} class:dv-check-failed={step.exitCode!==0}>{step.exitCode===0?'通过':'失败'}</span></li>{/each}</ol>
    {:else}<p class="dv-muted">本记录没有执行步骤；失败原因或上游成品来源见记录内容。</p>{/if}
    {#if result.dependencies?.length}<details class="dv-guide-trouble"><summary>依赖与锁文件</summary>{#each result.dependencies as dep}<p>{dep.path} · {dep.manager} · {dep.mode}</p>{#if dep.sha256}<code class="dv-code">{dep.sha256}</code>{/if}{/each}</details>{/if}
  {/if}
  {#each result.files??[] as file}
    <div class="dv-install-step"><div style="min-width:0"><h3 class="dv-mono">{file.filename}</h3><p>v{file.version} · {bytes(file.bytes)}</p>{#if downloadUrl(file.url)}<a class="dv-secondary" href={downloadUrl(file.url)} download={file.downloadFilename}>下载构建包 ↓</a>{:else}<p class="dv-muted">构建包待发布</p>{/if}<code class="dv-code">{file.sha256}</code></div></div>
  {/each}
  {#if result.files?.some(f=>f.inputs?.length)}<details class="dv-guide-trouble"><summary>上游成品与资源来源</summary>{#each result.files as file}{#each file.inputs??[] as input}<p>{input.url??input.name??'固定输入'}</p>{#if input.sha256}<code class="dv-code">{input.sha256}</code>{/if}{/each}{/each}</details>{/if}
  <p class="dv-mono">源码：<a class="dv-text-link" href={`https://github.com/${trial.repository}/tree/${trial.commit}`}>{trial.commit?.slice(0,12)??'未解析'}</a></p>
  <p>{#if summary?.recordUrl}<a class="dv-text-link" href={summary.recordUrl}>JSON 记录 ↓</a> · {/if}<a class="dv-text-link" href={trial.runUrl}>Actions 原始日志 ↗</a></p>
{/if}
