<script>
 let {onimport=()=>{},busy=false}= $props()
 let fileInput,folderInput,dragging=$state(false)
 function selected(event,directory=false){const files=Array.from(event.target.files??[]);onimport(directory?[files.map(file=>({file,relative:file.webkitRelativePath.split('/').slice(1).join('/')}))]:files.map(file=>[{file,relative:file.name}])) ;event.target.value=''}
 async function walk(entry,prefix=''){if(entry.isFile)return[{file:await new Promise((resolve,reject)=>entry.file(resolve,reject)),relative:prefix+entry.name}];const reader=entry.createReader(),children=[];for(;;){const chunk=await new Promise((resolve,reject)=>reader.readEntries(resolve,reject));if(!chunk.length)break;children.push(...chunk);if(children.length>100000)throw new Error('目录条目过多')}const files=[];for(const child of children)files.push(...await walk(child,prefix+entry.name+'/'));return files}
 async function dropped(event){event.preventDefault();dragging=false;try{const items=Array.from(event.dataTransfer.items).filter(x=>x.kind==='file');if(items.length>20)throw new Error('每批最多 20 项');const groups=[];for(const item of items){const entry=item.webkitGetAsEntry?.();if(entry){const files=await walk(entry);groups.push(entry.isDirectory?files.map(x=>({...x,relative:x.relative.split('/').slice(1).join('/')})):files)}else {const file=item.getAsFile();if(file)groups.push([{file,relative:file.name}])}}onimport(groups)}catch(e){onimport([],e)}}
</script>
<section class="panel"><div class="section-title"><span class="number">01</span><h2>导入离线插件</h2><span class="subtle">最多 20 项 / 批</span></div>
 <div role="region" aria-label="离线插件拖放区" class:dragging class="drop-zone" ondragover={e=>{e.preventDefault();dragging=true}} ondragleave={()=>dragging=false} ondrop={dropped}>
 <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M12 16V3m-5 5 5-5 5 5M4 14v6h16v-6"/></svg><strong>拖入 .tgz 离线包或成品文件夹</strong><p>目录必须已构建，并包含运行依赖。不会下载依赖或执行安装脚本。</p>
 <div class="actions"><button disabled={busy} onclick={()=>fileInput.click()}>选择文件</button><button class="secondary" disabled={busy} onclick={()=>folderInput.click()}>选择文件夹</button></div>
 <input hidden bind:this={fileInput} type="file" accept=".tgz" multiple onchange={e=>selected(e)}/><input hidden bind:this={folderInput} type="file" webkitdirectory onchange={e=>selected(e,true)}/>
 </div></section>
