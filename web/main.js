import { mount } from 'svelte'
import App from './App.svelte'
import './styles.css'

mount(App,{target:document.getElementById('app'),props:{initialPage:location.pathname.split('/').pop()||'index.html',initialSearch:location.search}})
