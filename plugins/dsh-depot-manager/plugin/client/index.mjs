import {createElement,useLayoutEffect,useRef} from 'react'
import {mountManager} from './client.mjs'
import styles from './styles.css'
import {registerManagerNavigation} from './navigation.mjs'

// A thin host-renderer adapter; the manager itself remains a Svelte page.
// Shadow DOM isolates its styles while inheriting the live DSH theme tokens.
function ManagerPanel(){
 const ref=useRef(null)
 useLayoutEffect(()=>{
  const shadow=ref.current.shadowRoot??ref.current.attachShadow({mode:'open'})
  const style=document.createElement('style'),container=document.createElement('div')
  style.textContent=styles
  shadow.replaceChildren(style,container)
  const dispose=mountManager(container,undefined,{embedded:true})
  return()=>{void dispose()}
 },[])
 return createElement('div',{ref,style:{height:'100%',minWidth:0,overflow:'auto'}})
}
function ManagerIcon(){
 return createElement('svg',{width:20,height:20,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:1.5,'aria-hidden':true},
  createElement('path',{d:'M4 8.5h16v11H4zM3 4.5h18v4H3zM9 12h6M12 2v2.5'}))
}
export const inject=['slots','layout']
export function apply(ctx){registerManagerNavigation(ctx,{Panel:ManagerPanel,Icon:ManagerIcon})}
