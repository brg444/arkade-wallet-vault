import { useCallback, useContext, useMemo, useSyncExternalStore } from 'react'
import { parseRecoveryKit } from '../../../lib/vault/program/kit'
import { VaultContext } from '../../../vault/context'

const EVENT = 'vaulted-backup-confirmation'

function subscribe(onChange: () => void) {
  window.addEventListener('storage', onChange)
  window.addEventListener(EVENT, onChange)
  return () => {
    window.removeEventListener('storage', onChange)
    window.removeEventListener(EVENT, onChange)
  }
}

// A user acknowledgement, scoped to the exact kit. This is not verification
// that a downloaded file exists, is readable, or can recover funds.
export function useBackupConfirmation() {
  const { downloadRecoveryKit } = useContext(VaultContext)
  const key = useMemo(() => {
    try {
      const kit = parseRecoveryKit(JSON.parse(downloadRecoveryKit()))
      return `vaulted-backup-confirmed:${kit.descriptorHash}`
    } catch {
      return null
    }
  }, [downloadRecoveryKit])
  const read = useCallback(() => {
    try {
      return key ? localStorage.getItem(key) === 'confirmed-by-user' : false
    } catch {
      return false
    }
  }, [key])
  const confirmed = useSyncExternalStore(subscribe, read, () => false)
  const confirm = () => {
    if (!key) return false
    try {
      localStorage.setItem(key, 'confirmed-by-user')
      window.dispatchEvent(new Event(EVENT))
      return true
    } catch {
      return false
    }
  }
  return { confirmed, confirm }
}
