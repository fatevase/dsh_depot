import {cliWebAdapter} from './cli-web.mjs'
import {officialDesktopAdapter} from './official-desktop.mjs'
export const adapterFor=host=>host.kind==='official-desktop'?officialDesktopAdapter():cliWebAdapter()
