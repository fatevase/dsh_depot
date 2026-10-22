export {LIMITS,ManagerError,fail} from '@dsh-depot/offline-format/constants'
export const MANAGER_NAME='dsh-depot-manager'
import manifest from '../plugin/package.json' with {type:'json'}
export const MANAGER_VERSION=manifest.version
export const CORE_NODE_RANGE='^22.19.0 || >=24.0.0'
export const STATES=Object.freeze(['inspecting','blocked','ready','queued','waiting_for_host_exit','backing_up','applying','checking_install','awaiting_reload','succeeded','recovering','failed','failed_restored','recovery_required','cancelled'])
