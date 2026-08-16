import { createContext, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { authorizerBase, fetchVaultStatus, parseStatusJson } from '../lib/vault/status'
import { hashDescriptor, validateDescriptor } from '../lib/vault/descriptor'
import { clearWatchRecord, loadWatchRecord, saveWatchRecord } from '../lib/vault/store'
import type { VaultPublicDescriptor, VaultStatus, WatchRecord } from '../lib/vault/types'

export type VaultScreen = 'init' | 'home' | 'receive' | 'roles'

interface VaultContextProps {
  authorizerOrigin: string
  descriptor: VaultPublicDescriptor | null
  descriptorHash: string | null
  error: string
  importDescriptor: (raw: string) => void
  importStatusJson: (raw: string) => void
  loaded: boolean
  navigate: (screen: VaultScreen) => void
  refreshStatus: () => Promise<void>
  reset: () => void
  screen: VaultScreen
  status: VaultStatus | null
}

export const VaultContext = createContext<VaultContextProps>({
  authorizerOrigin: '',
  descriptor: null,
  descriptorHash: null,
  error: '',
  importDescriptor: () => {},
  importStatusJson: () => {},
  loaded: false,
  navigate: () => {},
  refreshStatus: async () => {},
  reset: () => {},
  screen: 'init',
  status: null,
})

export function VaultProvider({ children }: { children: ReactNode }) {
  const [loaded, setLoaded] = useState(false)
  const [watch, setWatch] = useState<WatchRecord | null>(null)
  const [status, setStatus] = useState<VaultStatus | null>(null)
  const [error, setError] = useState('')
  const [screen, setScreen] = useState<VaultScreen>('init')
  const authorizerOrigin = authorizerBase() || (typeof window !== 'undefined' ? window.location.origin : '')

  useEffect(() => {
    try {
      const rec = loadWatchRecord()
      setWatch(rec)
      if (rec) setScreen('home')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'watch record is unreadable')
    } finally {
      setLoaded(true)
    }
  }, [])

  const refreshStatus = useCallback(async () => {
    setError('')
    const next = await fetchVaultStatus()
    setStatus(next)
  }, [])

  const importDescriptor = useCallback(
    (raw: string) => {
      const parsed = validateDescriptor(JSON.parse(raw) as VaultPublicDescriptor)
      const rec = saveWatchRecord(parsed, authorizerOrigin)
      setWatch(rec)
      setError('')
      setScreen('home')
    },
    [authorizerOrigin],
  )

  const importStatusJson = useCallback(
    (raw: string) => {
      const next = parseStatusJson(raw)
      setStatus(next)
      setError('')
      if (next.enrolled && watch) setScreen('home')
    },
    [watch],
  )

  const reset = useCallback(() => {
    clearWatchRecord()
    setWatch(null)
    setStatus(null)
    setError('')
    setScreen('init')
  }, [])

  const value = useMemo<VaultContextProps>(
    () => ({
      authorizerOrigin,
      descriptor: watch?.descriptor ?? null,
      descriptorHash: watch ? hashDescriptor(watch.descriptor) : null,
      error,
      importDescriptor,
      importStatusJson,
      loaded,
      navigate: setScreen,
      refreshStatus,
      reset,
      screen,
      status,
    }),
    [authorizerOrigin, error, importDescriptor, importStatusJson, loaded, refreshStatus, reset, screen, status, watch],
  )

  return <VaultContext.Provider value={value}>{children}</VaultContext.Provider>
}
