<script>
  import {bytes,platforms} from './catalog.mjs'
  let {trial,target}=$props()
  let result=$derived(trial.results[target])
</script>
{#if result}
  <div class="dv-doc-note" class:dv-doc-warning={result.status!=='compiled'}>
    <strong>{platforms[target]} · {result.status==='compiled'?'已构建 · 未离线验证':result.status==='failed'?'构建失败':'未收到构建结果'}</strong>
    {#if result.status==='compiled'}<p>已完成编译打包或成品检查，尚未完成离线安装验证。</p>{:else if result.error}<details><summary>失败原因 · {result.errorCategory??'构建'}</summary><pre class="dv-code" style="white-space:pre-wrap;max-height:280px;overflow:auto">{result.error}</pre></details>{/if}
    <p><a class="dv-text-link" href={trial.runUrl}>查看本轮构建 ↗</a>{#if result.artifactsUrl}<span aria-hidden="true"> · </span><a class="dv-text-link" href={result.artifactsUrl}>查看构建产物 ↗</a>{/if}</p>
    {#if result.artifactsUrl}<p class="dv-muted">需登录 GitHub；下载包包含同批次插件，按文件名选择。产物保留至 {new Date(result.artifactsExpiresAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})}。</p>{/if}
  </div>
  {#each result.files as file}
    <div class="dv-install-step"><div style="min-width:0"><h3 class="dv-mono">{file.filename}</h3><p>v{file.version} · {bytes(file.bytes)}</p><code class="dv-code">{file.sha256}</code></div></div>
  {/each}
  <p class="dv-mono">源码：<a class="dv-text-link" href={`https://github.com/${trial.repository}/tree/${trial.commit}`}>{trial.commit?.slice(0,12)??'未解析'}</a></p>
{/if}
