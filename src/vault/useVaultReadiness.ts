import { useEffect, useState } from 'react'
import { consoleError, consoleLog } from '../lib/logs'
import { fetchVaultReadiness, VaultReadinessResponseError, type VaultReadyStatus } from '../lib/vault/status'

export type VaultReadinessState = 'checking' | 'ready' | 'unavailable' | 'unreachable'

export function useVaultReadiness(): { state: VaultReadinessState; status?: VaultReadyStatus } {
  const [readiness, setReadiness] = useState<{ state: VaultReadinessState; status?: VaultReadyStatus }>({
    state: 'checking',
  })

  useEffect(() => {
    const controller = new AbortController()
    void fetchVaultReadiness(controller.signal)
      .then((result) => {
        if (result.state === 'unavailable' && result.status.error) {
          consoleLog('Vault readiness unavailable', result.status.error)
        }
        setReadiness(result)
      })
      .catch((error) => {
        if (controller.signal.aborted) return
        consoleError(error, 'Vault readiness check')
        setReadiness({ state: error instanceof VaultReadinessResponseError ? 'unavailable' : 'unreachable' })
      })
    return () => controller.abort()
  }, [])

  return readiness
}
