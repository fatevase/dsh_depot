import {defineConfig} from 'vite'
import {svelte} from '@sveltejs/vite-plugin-svelte'
import {fileURLToPath} from 'node:url'
export default defineConfig({base:'./',publicDir:fileURLToPath(new URL('../.runtime/web/site/',import.meta.url)),plugins:[svelte()]})
