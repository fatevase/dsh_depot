<script>
  let {id}=$props()
  const icons={
    'free-model':{color:'#6372c7',path:'M12 3 3 8l9 5 9-5-9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5'},
    'dsh-web':{color:'#527c8c',path:'M4 4h16v16H4zM4 9h16M9 9v11M7 6.5h.01M10 6.5h.01'},
    purge:{color:'#a47458',path:'m8 3 2 4-5 10 4 3 6-9 5-2-2-4-5 3-3-2-2-3ZM6 15l5 3M4 21h15'},
    'routing-suite':{color:'#71806a',path:'M5 4v5c0 3 14 3 14 6v5M5 9c0 3 7 3 7 6v5M2 4h6M9 20h6M16 20h6'},
    sidebar:{color:'#6673bf',path:'M4 4h16v16H4zM10 4v16M6.5 8h1M6.5 12h1M6.5 16h1M13 8h4M13 12h4'},
    market:{color:'#8b7556',path:'M4 8h16l-1 12H5L4 8Zm4 0V6a4 4 0 0 1 8 0v2M9 12v.01M15 12v.01'},
    modlens:{color:'#68858b',path:'M3 8V4h4M17 4h4v4M21 16v4h-4M7 20H3v-4M7 12a5 5 0 1 0 10 0 5 5 0 1 0-10 0M10 12h4M12 10v4'},
    'whale-widget':{color:'#587eac',path:'M3 12c1 0 2-2 3-3 0 2 0 3 1 4 2-3 5-5 9-5 3 0 5 2 5 5s-3 6-7 6C8 19 4 17 3 12Zm13-1h.01M13 4l1 2M17 3v3M20 4l-1 2'},
    treg:{color:'#91768b',path:'M4 5h6l2 3h8v12H4V5Zm4 7h8M8 16h5M15 3h5v5'},
    tui:{color:'#67756e',path:'M3 4h18v16H3V4Zm0 4h18M7 11l3 3-3 3M13 17h4'},
    taskfold:{color:'#8b7556',path:'M5 4h14v16H5V4Zm3 4h8M8 12h8m-8 4h4'},
    'multi-root':{color:'#71806a',path:'M3 5h6l2 3h10v12H3V5Zm4 7h10M12 9v8'},
    mobile:{color:'#68858b',path:'M7 3h10v18H7V3Zm4 15h2'},
    fallback:{color:'#6673bf',path:'m12 3 8 4v10l-8 4-8-4V7l8-4Zm-8 4 8 4 8-4M12 11v10'}
  }
  let icon=$derived(icons[id]??icons.fallback)
</script>
<svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style:color={icon.color} style="width:65%;height:65%"><path d={icon.path}/></svg>
