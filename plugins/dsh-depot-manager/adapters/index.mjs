import {cliWebAdapter} from './cli-web.mjs'
import {officialDesktopAdapter} from './official-desktop.mjs'
export const adapterFor=host=>host.kind==='cli-web'?cliWebAdapter():officialDesktopAdapter()
export {runHostCommand} from './command.mjs'
export {discoverHosts,probeHost,hostFingerprint} from './discover.mjs'
