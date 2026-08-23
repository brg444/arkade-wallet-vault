import { useCallback, type Dispatch, type SetStateAction } from 'react'
import {
  findStoredEnrollment,
  loadSelectedVaultId,
  saveEnrollment,
  saveSelectedVaultId,
  setSessionLocked,
} from '../lib/vault/enrollmentStore'
import { humanizeVaultError } from '../lib/vault/humanize'
import { loadAddressPin, type AddressPin } from '../lib/vault/pin'
import {
  discoverVaultIdFromPasskey,
  enablePasskeyLogin,
  signInWithPasskey,
  unlockLocalEnrollment,
} from '../lib/vault/signIn'
import { planReady, sameBip340Key, type VaultSetupPlan } from '../lib/vault/setupPlan'
import { fetchVaultStatus } from '../lib/vault/status'
import { enrollWithPasskey, type EnrollmentSecrets } from '../lib/vault/tenantEnrollment'
import type { VaultStatus } from '../lib/vault/types'
import { kitFromFacts, pullMapBackup, pushMapBackup } from '../lib/vault/program/kitBackup'
import { saveLocalKit } from '../lib/vault/program/kitStore'
import type { VaultScreen } from './context'

interface VaultSessionOptions {
  enrollment: EnrollmentSecrets | null
  refreshBalance: (vaultId?: string) => Promise<void>
  reportError: (message: string) => void
  sealPlan: () => VaultSetupPlan
  setAddressPin: Dispatch<SetStateAction<AddressPin | null>>
  setBusy: Dispatch<SetStateAction<boolean>>
  setEnrollment: Dispatch<SetStateAction<EnrollmentSecrets | null>>
  setLocked: Dispatch<SetStateAction<boolean>>
  setScreen: Dispatch<SetStateAction<VaultScreen>>
  setStatus: Dispatch<SetStateAction<VaultStatus | null>>
  setup: VaultSetupPlan
  status: VaultStatus | null
}

async function restoreMap(enrollment: EnrollmentSecrets, status: VaultStatus, setup: VaultSetupPlan) {
  try {
    const pulled = status.vaultId ? await pullMapBackup(status.vaultId) : null
    const kit =
      pulled?.kit ||
      kitFromFacts({
        enrollment,
        status,
        hardwarePub: setup.hardwarePub,
        recoveryPub: setup.recoveryPub || status.recoveryPub,
      })
    if (kit) saveLocalKit(kit)
  } catch {
    // Authentication is independent of the optional recovery-map backup.
  }
}

// useVaultSession owns enrollment and passkey session transitions. It commits
// local credentials and the selected vault together before exposing Home.
export function useVaultSession({
  enrollment,
  refreshBalance,
  reportError,
  sealPlan,
  setAddressPin,
  setBusy,
  setEnrollment,
  setLocked,
  setScreen,
  setStatus,
  setup,
  status,
}: VaultSessionOptions) {
  const enroll = useCallback(
    async (token = '') => {
      if (!planReady(setup)) {
        reportError('Finish setup first.')
        return
      }
      if (status?.externalOwnerWalletPub && !sameBip340Key(setup.hardwarePub, status.externalOwnerWalletPub)) {
        reportError('This vault expects a different hardware key.')
        return
      }
      if (token.trim().length < 32) {
        reportError('Paste your invite.')
        return
      }
      setBusy(true)
      reportError('')
      try {
        const result = await enrollWithPasskey(token, {
          hardwarePub: setup.hardwarePub,
          ...(setup.recoveryPub ? { recoveryPub: setup.recoveryPub } : {}),
        })
        setEnrollment(result.enrollment)
        saveEnrollment(result.enrollment)
        saveSelectedVaultId(result.enrollment.vaultId)
        setStatus(result.status)
        setAddressPin(loadAddressPin(localStorage, result.status.vaultId))
        sealPlan()
        try {
          const kit = kitFromFacts({
            enrollment: result.enrollment,
            status: result.status,
            hardwarePub: setup.hardwarePub,
            recoveryPub: setup.recoveryPub || result.status.recoveryPub,
          })
          if (!kit) throw new Error('vault service did not return the committed Recovery Kit facts')
          saveLocalKit(kit)
          await pushMapBackup(kit.descriptor.vaultId, kit)
        } catch {
          // Enrollment already saved the server-proposed kit locally. Remote
          // backup remains best effort and never replaces that committed map.
        }
        try {
          setStatus(await enablePasskeyLogin(result.enrollment))
        } catch {
          reportError('Vault is set up. Other-device sign-in is not on yet. Tap Allow other devices and use Face ID.')
        }
        await refreshBalance(result.status.vaultId)
        setScreen('home')
      } catch (error) {
        reportError(humanizeVaultError(error))
      } finally {
        setBusy(false)
      }
    },
    [refreshBalance, reportError, sealPlan, setAddressPin, setBusy, setEnrollment, setScreen, setStatus, setup, status],
  )

  const enableOtherDevices = useCallback(async () => {
    if (!enrollment) {
      reportError('Finish setup first.')
      return
    }
    setBusy(true)
    reportError('')
    try {
      setStatus(await enablePasskeyLogin(enrollment))
    } catch (error) {
      reportError(humanizeVaultError(error))
    } finally {
      setBusy(false)
    }
  }, [enrollment, reportError, setBusy, setStatus])

  const signIn = useCallback(async () => {
    setBusy(true)
    reportError('')
    try {
      const local = enrollment || findStoredEnrollment()
      if (local) {
        const unlocked = await unlockLocalEnrollment(local)
        setEnrollment(unlocked)
        saveEnrollment(unlocked)
        saveSelectedVaultId(unlocked.vaultId)
        setSessionLocked(false)
        setLocked(false)
        const live = await fetchVaultStatus(undefined, unlocked.vaultId)
        setStatus(live)
        setAddressPin(loadAddressPin(localStorage, live.vaultId))
        await restoreMap(unlocked, live, setup)
        await refreshBalance(live.vaultId)
        setScreen('home')
        return
      }
      const selected = loadSelectedVaultId()
      const vaultId = selected || (await discoverVaultIdFromPasskey())
      const result = await signInWithPasskey(vaultId)
      setEnrollment(result.enrollment)
      saveEnrollment(result.enrollment)
      saveSelectedVaultId(result.enrollment.vaultId)
      setSessionLocked(false)
      setLocked(false)
      setStatus(result.status)
      setAddressPin(loadAddressPin(localStorage, result.status.vaultId))
      await restoreMap(result.enrollment, result.status, setup)
      await refreshBalance(result.status.vaultId)
      setScreen('home')
    } catch (error) {
      reportError(humanizeVaultError(error))
    } finally {
      setBusy(false)
    }
  }, [
    enrollment,
    refreshBalance,
    reportError,
    setAddressPin,
    setBusy,
    setEnrollment,
    setLocked,
    setScreen,
    setStatus,
    setup,
  ])

  return { enableOtherDevices, enroll, signIn }
}
