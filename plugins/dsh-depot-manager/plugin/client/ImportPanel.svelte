<script>
 let {onimport = () => {}, busy = false} = $props()
 let fileInput, folderInput
 let dragging = $state(false)

 function selected(event, directory = false) {
  const files = Array.from(event.target.files ?? [])
  if (files.length) onimport(directory
   ? [files.map(file => ({file, relative: file.webkitRelativePath.split('/').slice(1).join('/')}))]
   : files.map(file => [{file, relative: file.name}]))
  event.target.value = ''
 }

 async function walk(entry, prefix = '') {
  if (entry.isFile) return [{file: await new Promise((resolve, reject) => entry.file(resolve, reject)), relative: prefix + entry.name}]
  const reader = entry.createReader(), children = []
  for (;;) {
   const chunk = await new Promise((resolve, reject) => reader.readEntries(resolve, reject))
   if (!chunk.length) break
   children.push(...chunk)
   if (children.length > 100000) throw new Error('目录条目过多')
  }
  const files = []
  for (const child of children) files.push(...await walk(child, prefix + entry.name + '/'))
  return files
 }

 async function dropped(event) {
  event.preventDefault()
  dragging = false
  if (busy) return
  try {
   const items = Array.from(event.dataTransfer.items ?? []).filter(item => item.kind === 'file')
   if (items.length > 20) throw new Error('一次最多选择 20 个安装包')
   const sources = items.map(item => ({entry: item.webkitGetAsEntry?.(), file: item.getAsFile()}))
   const groups = []
   for (const {entry, file} of sources) {
    if (entry) {
     const files = await walk(entry)
     groups.push(entry.isDirectory ? files.map(item => ({...item, relative: item.relative.split('/').slice(1).join('/')})) : files)
    } else if (file) groups.push([{file, relative: file.name}])
   }
   if (groups.length) onimport(groups)
  } catch (e) { onimport([], e) }
 }
</script>

<section class="depot-drop" class:depot-dragging={dragging} role="region" aria-label="拖入插件安装包"
 ondragover={event => { event.preventDefault(); if (!busy) dragging = true }}
 ondragleave={event => { if (!event.currentTarget.contains(event.relatedTarget)) dragging = false }}
 ondrop={dropped}>
 <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M12 15V3m-4 4 4-4 4 4M4 14v6h16v-6"/></svg>
 <p>拖入插件安装包或已构建的文件夹</p>
 <div class="depot-actions">
  <button class="depot-button depot-outline" disabled={busy} onclick={() => fileInput.click()}>选择安装包</button>
  <button class="depot-button depot-ghost" disabled={busy} onclick={() => folderInput.click()}>选择文件夹</button>
 </div>
 <input hidden bind:this={fileInput} type="file" accept=".tgz" multiple aria-label="选择插件安装包" onchange={event => selected(event)} />
 <input hidden bind:this={folderInput} type="file" webkitdirectory aria-label="选择插件文件夹" onchange={event => selected(event, true)} />
</section>
