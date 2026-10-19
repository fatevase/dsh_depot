import {createElement, useEffect, useRef} from 'react'
import {mountManager} from './client.mjs'
import styles from './styles.css'

export const name = 'dsh-depot-manager'
export const inject = ['slots']

function LocalPluginsSection() {
 const target = useRef(null)
 useEffect(() => mountManager(target.current), [])
 return createElement('div', {ref: target})
}

export function apply(ctx) {
 ctx.effect(() => {
  const style = document.createElement('style')
  style.dataset.plugin = 'dsh-depot-manager'
  style.textContent = styles
  document.head.append(style)
  return () => style.remove()
 }, 'depot-manager: settings styles')
 ctx.slots.inject('settings.section', () => ctx.slots.register({
  name: 'settings.section', id: 'depot-manager', order: 45,
  label: () => '本地插件',
 }, LocalPluginsSection))
}
