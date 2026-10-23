export const PANEL_ID='dsh-depot-manager'

// Register with the standard sidebar so its position, tooltip and collapsed
// presentation stay under DSH's control, including when no sidebar plugin exists.
export function registerManagerNavigation(ctx,{Panel,Icon}) {
 ctx.slots.inject('main',()=>{
  const dispose=ctx.slots.register({name:'main',key:PANEL_ID},Panel)
  // The previous standalone URL redirects here; preserve other DSH parameters.
  if(typeof window!=='undefined'){
   const url=new URL(window.location.href)
   if(url.searchParams.get('depot')==='manager'){
    ctx.layout.selectPanel(PANEL_ID)
    url.searchParams.delete('depot')
    window.history.replaceState(window.history.state,'',url)
   }
  }
  return dispose
 })
 ctx.slots.inject('sidebar.panellist',()=>ctx.slots.register({
  name:'sidebar.panellist',id:PANEL_ID,order:1,label:()=> '离线插件',
 },Icon))
}
