export {LIMITS,ManagerError,fail} from '@dsh-depot/offline-format/constants'
export const MANAGER_NAME='dsh-depot-manager'
export const MANAGER_VERSION='0.1.0'
export const CORE_NODE_RANGE='^22.19.0 || >=24.0.0'
export const STATES=Object.freeze(['inspecting','blocked','ready','queued','waiting_for_host_exit','backing_up','applying','checking_install','awaiting_reload','succeeded','recovering','failed_restored','recovery_required','cancelled'])
