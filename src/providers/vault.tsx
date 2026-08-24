import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { NetworkName } from '@arkade-os/sdk'
import { DUST_SATS } from '../lib/vault/constants'
import { reconcileStagedEnrollment, type EnrollmentSecrets } from '../lib/vault/tenantEnrollment'
import {
  findStoredEnrollment,
  loadEnrollment,
  loadSelectedVaultId,
  loadSessionLocked,
  saveSelectedVaultId,
  setSessionLocked,
} from '../lib/vault/enrollmentStore'
import { loadAddressPin, type AddressPin } from '../lib/vault/pin'
import { zeroBytes } from '../lib/vault/ceremony/directauth'
import { broadcastTx, confirmedSpendables, fetchAddressUtxos } from '../lib/vault/esplora'
import { recentAccountHistory, type VaultHistoryItem } from '../lib/vault/history'
import {
  buildSavingsPsbt,
  finalizeSavingsPsbt,
  parseIncomingPsbt,
  requireSameSavingsIntent,
  signSavingsPsbt,
  unlockPhoneBip340,
} from '../lib/vault/savingsSpend'
import {
  clearPendingSavingsHandoff,
  createPendingSavingsHandoff,
  loadPendingSavingsHandoff,
  savePendingSavingsHandoff,
  type PendingSavingsHandoff,
} from '../lib/vault/savingsHandoff'
import { humanizeVaultError } from '../lib/vault/humanize'
import { isVaultArkAddress, isVaultSpendAddress } from '../lib/vault/bitcoin'
import {
  isVaultLightningInput,
  vaultLightningSendEnabled,
  vaultLightningSolverProfile,
} from '../lib/vault/lightningConfig'
import { decodeVaultLightningInvoice } from '../lib/vault/lightningInvoice'
import type { VaultLightningQuote } from '../lib/vault/lightningLifecycle'
import {
  isVtxoReceiptPendingError,
  isVtxoReviewedReservationError,
  isVtxoSpendInFlightError,
  reserveVaultVtxo,
  sendVaultVtxo,
  type VaultVtxoSpendQuote,
  vaultArkServer,
} from '../lib/vault/vtxo/spend'
import { verifyVaultBoarding } from '../lib/vault/vtxo/board'
import { fetchPublicStatus, fetchVaultStatus, type PublicAuthorizerStatus } from '../lib/vault/status'
import {
  clearSetupPlan,
  emptySetupPlan,
  loadSetupPlan,
  parseCompressedPub,
  planReady,
  saveSetupPlan,
  sameBip340Key,
  sameRole,
  type VaultSetupPlan,
} from '../lib/vault/setupPlan'

import type { VaultStatus } from '../lib/vault/types'
import {
  DEFAULT_SPEND_FEE_SATS,
  VaultContext,
  type VaultAccount,
  type VaultContextProps,
  type VaultScreen,
  type VaultSpend,
} from '../vault/context'
import { useRecoveryKit } from '../vault/useRecoveryKit'
import { useVaultBalances } from '../vault/useVaultBalances'
import { useVaultSession } from '../vault/useVaultSession'

export { VaultContext } from '../vault/context'
export type { VaultAccount, VaultContextProps, VaultScreen, VaultSpend } from '../vault/context'

const DEFAULT_FEE = DEFAULT_SPEND_FEE_SATS
const LIVE_FEE = 1500

export function vaultDraftFee(account: VaultAccount, liveNetwork: boolean): number {
  return account === 'spend' ? 0 : liveNetwork ? LIVE_FEE : DEFAULT_FEE
}

export function reviewedVtxoQuoteMatchesDraft(quote: VaultVtxoSpendQuote | null, spend: VaultSpend): boolean {
  return Boolean(
    quote &&
      quote.destAddress.trim() === spend.address.trim() &&
      quote.amountSats === spend.amount &&
      quote.feeSats === spend.fee,
  )
}

export function spendingPositionBalance(vtxoSats: number, boardingSats: number): number {
  return vtxoSats + boardingSats
}

export function VaultProvider({ children }: { children: ReactNode }) {
  const [screen, setScreen] = useState<VaultScreen>('welcome')
  const [recoverEntry, setRecoverEntry] = useState<'kit' | 'lost'>('kit')
  const [recoverExit, setRecoverExit] = useState<VaultScreen>('keys')
  const [setup, setSetup] = useState<VaultSetupPlan>(emptySetupPlan)
  const [status, setStatus] = useState<VaultStatus | null>(null)
  const [deployment, setDeployment] = useState<PublicAuthorizerStatus | null>(null)
  const [enrollment, setEnrollment] = useState<EnrollmentSecrets | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [spend, setSpend] = useState<VaultSpend>({ address: '', amount: 0, fee: 0 })
  const spendRef = useRef(spend)
  spendRef.current = spend
  const [reviewedVtxoQuote, setReviewedVtxoQuote] = useState<VaultVtxoSpendQuote | null>(null)
  const [lightningQuote, setLightningQuote] = useState<VaultLightningQuote | null>(null)
  const [lastSend, setLastSend] = useState<VaultSpend | null>(null)
  const [lastTxid, setLastTxid] = useState('')
  const [lastTxKind, setLastTxKind] = useState<'onchain' | 'vtxo' | 'lightning' | ''>('')
  const [selectedTx, setSelectedTx] = useState<VaultHistoryItem | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [initialStatusChecked, setInitialStatusChecked] = useState(false)
  const [account, setAccount] = useState<VaultAccount>('spend')
  const [scanOnSend, setScanOnSend] = useState(false)
  const [handoffPsbt, setHandoffPsbt] = useState('')
  const [pendingSavingsHandoff, setPendingSavingsHandoff] = useState<PendingSavingsHandoff | null>(null)
  const [locked, setLocked] = useState(false)
  const [addressPin, setAddressPin] = useState<AddressPin | null>(null)

  useEffect(() => {
    let existing: EnrollmentSecrets | null = null
    let existingPin: AddressPin | null = null
    try {
      const plan = loadSetupPlan()
      if (plan) {
        setSetup(plan)
        if (plan.complete) {
          setScreen('passkey')
        }
      }
      const selected = loadSelectedVaultId()
      existing = selected ? loadEnrollment(localStorage, selected) : findStoredEnrollment()
      if (existing?.vaultId) saveSelectedVaultId(existing.vaultId)
      const pinId = existing?.vaultId || selected
      existingPin = pinId ? loadAddressPin(localStorage, pinId) : null
      setAddressPin(existingPin)
      const sessionLocked = loadSessionLocked()
      setLocked(sessionLocked)
      if (existing) setEnrollment(existing)
      if (existing && !sessionLocked) {
        if (existingPin) {
          setScreen('home')
        } else {
          setSessionLocked(true)
          setLocked(true)
          setScreen('signin')
        }
      }
    } catch {
      clearSetupPlan()
    } finally {
      setLoaded(true)
    }
    const selectedId = existing?.vaultId || loadSelectedVaultId()
    const boot = async () => {
      try {
        const recovered = await reconcileStagedEnrollment()
        if (recovered && !loadSessionLocked()) {
          setEnrollment(recovered.enrollment)
          setStatus(recovered.status)
          setAddressPin(loadAddressPin(localStorage, recovered.status.vaultId))
          setScreen('home')
          return
        }
        if (selectedId) {
          const live = await fetchVaultStatus(undefined, selectedId)
          setStatus(live)
          setAddressPin(loadAddressPin(localStorage, live.vaultId))
        } else {
          setDeployment(await fetchPublicStatus())
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : ''
        if (msg.includes('local pin') || msg.includes('not pinned locally')) {
          setError(humanizeVaultError(err))
        }
      } finally {
        setInitialStatusChecked(true)
      }
    }
    void boot()
  }, [])

  useEffect(() => {
    const vaultId = status?.vaultId || enrollment?.vaultId || ''
    if (!vaultId) return
    const pending = loadPendingSavingsHandoff(localStorage, vaultId)
    setPendingSavingsHandoff(pending)
    if (pending) setHandoffPsbt(pending.psbtHex)
  }, [enrollment?.vaultId, status?.vaultId])

  useEffect(() => {
    if (!pendingSavingsHandoff) return
    const delay = Math.max(0, pendingSavingsHandoff.expiresAt - Date.now())
    const timeout = window.setTimeout(() => {
      try {
        clearPendingSavingsHandoff(localStorage, pendingSavingsHandoff.vaultId)
      } catch {
        // Expiry still clears the active session when browser storage is unavailable.
      }
      setPendingSavingsHandoff(null)
      setHandoffPsbt('')
      setScreen((current) => (current === 'handoff' ? 'home' : current))
    }, delay)
    return () => window.clearTimeout(timeout)
  }, [pendingSavingsHandoff])

  useEffect(() => {
    if (!status || status.network !== 'mutinynet') return
    if (account === 'savings') {
      setSpend((prev) => (prev.fee === LIVE_FEE ? prev : { ...prev, fee: LIVE_FEE }))
    }
    setSetup((prev) => {
      const next = {
        ...prev,
        txCapSats: status.txCap || prev.txCapSats,
        dailyLimitSats: status.periodAllowance || prev.dailyLimitSats,
      }
      if (next.txCapSats === prev.txCapSats && next.dailyLimitSats === prev.dailyLimitSats) {
        return prev
      }
      saveSetupPlan(next)
      return next
    })
  }, [account, status])

  const persist = useCallback((next: VaultSetupPlan) => {
    setSetup(next)
    saveSetupPlan(next)
    return next
  }, [])

  const spendingArkAddress = status?.spendingArkAddress || ''
  const boardingAddress = status?.vtxoBoardingAddress || ''
  const savingsAddress = addressPin?.savingsAddress || ''
  const liveNetwork = (status?.network || deployment?.network) === 'mutinynet'
  const selectAccount = useCallback(
    (next: VaultAccount) => {
      setAccount(next)
      setReviewedVtxoQuote(null)
      setLightningQuote(null)
      setSpend((previous) => ({ ...previous, fee: vaultDraftFee(next, liveNetwork) }))
    },
    [liveNetwork],
  )
  const reportError = useCallback((message: string) => setError(message), [])
  const onBoarded = useCallback((txid: string) => {
    setLastTxid(txid)
    setLastTxKind('vtxo')
  }, [])
  const {
    balanceError,
    balancesLoaded,
    boardingBalance,
    boardingInProgress,
    history,
    refreshBalance,
    refreshingBalance,
    savingsSats,
    savingsSpendableSats,
    vtxoSpendingSats,
  } = useVaultBalances({
    addressPin,
    busy,
    enrollment,
    initialStatusChecked,
    locked,
    onBoarded,
    reportError,
    setStatus,
    status,
  })
  const dailyLimit = status?.enrolled ? (status.periodAllowance ?? setup.dailyLimitSats) : setup.dailyLimitSats
  const dailyRemaining = status?.enrolled ? (status.periodRemaining ?? dailyLimit) : 0
  const amountSats = status?.enrolled ? spendingPositionBalance(vtxoSpendingSats, boardingBalance) : 0
  const enrolled = Boolean(status?.enrolled)
  const networkLabel = liveNetwork ? 'Mutinynet' : 'Test network'
  const clearError = useCallback(() => reportError(''), [reportError])

  useEffect(() => {
    setSelectedTx((current) => {
      if (!current) return current
      return history.find((item) => item.account === current.account && item.txid === current.txid) || current
    })
  }, [history])
  const visibleHistory = useMemo<VaultHistoryItem[]>(
    () =>
      pendingSavingsHandoff
        ? [
            {
              txid: `pending-savings:${pendingSavingsHandoff.createdAt}`,
              type: 'sent',
              amount: pendingSavingsHandoff.amountSats + pendingSavingsHandoff.feeSats,
              confirmed: false,
              blockTime: Math.floor(pendingSavingsHandoff.createdAt / 1000),
              account: 'savings',
              activity: 'savings-handoff',
            },
            ...history,
          ]
        : history,
    [history, pendingSavingsHandoff],
  )
  const {
    backupRecoveryKit,
    downloadRecoveryKit,
    hasRecoveryKit,
    initiateAlert,
    initiateAlerts,
    restoreRecoveryKit,
    signGuardianExitWithDevice,
  } = useRecoveryKit({
    enrollment,
    status,
    hardwarePub: setup.hardwarePub,
    recoveryPub: setup.recoveryPub,
    clearError,
  })

  const acceptDesign = useCallback(() => {
    persist({ ...setup, acceptedDesign: true })
    setError('')
    setScreen('hardware')
  }, [persist, setup])

  const applyHardware = useCallback(
    (raw: string) => {
      setError('')
      try {
        const hardwarePub = parseCompressedPub(raw, 'hardware key')
        if (status?.externalOwnerWalletPub && !sameBip340Key(hardwarePub, status.externalOwnerWalletPub)) {
          throw new Error('This Mutinynet vault requires the hardware key already configured on the service')
        }
        persist({ ...setup, hardwarePub })
        setScreen('recovery')
      } catch (err) {
        setError(humanizeVaultError(err))
      }
    },
    [persist, setup, status?.externalOwnerWalletPub],
  )

  const applyRecovery = useCallback(
    (raw: string) => {
      setError('')
      try {
        const recoveryPub = parseCompressedPub(raw, 'recovery key')
        if (!setup.hardwarePub) throw new Error('Set hardware first')
        if (sameRole(recoveryPub, setup.hardwarePub)) throw new Error('Recovery must be a different key')
        persist({ ...setup, recoveryPub })
        setScreen('conditions')
      } catch (err) {
        setError(humanizeVaultError(err))
      }
    },
    [persist, setup],
  )

  const skipRecovery = useCallback(() => {
    setError('')
    persist({ ...setup, recoveryPub: '' })
    setScreen('conditions')
  }, [persist, setup])

  const confirmConditions = useCallback(() => {
    setError('')
    setScreen('plan')
  }, [])

  const finishPlan = useCallback(() => {
    setError('')
    if (!planReady(setup)) {
      setError('Finish setup first.')
      return
    }
    setScreen('passkey')
  }, [setup])

  const sealPlan = useCallback(() => {
    const next = persist({ ...setup, complete: true })
    return next
  }, [persist, setup])

  const { enableOtherDevices, enroll, signIn } = useVaultSession({
    enrollment,
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
  })

  const setSpendDraft = useCallback(
    (draft: Partial<VaultSpend>) => {
      setReviewedVtxoQuote(null)
      setLightningQuote(null)
      setSpend((prev) => {
        const next = { ...prev, ...draft }
        next.fee = vaultDraftFee(account, liveNetwork)
        return next
      })
      setError('')
    },
    [account, liveNetwork],
  )

  const reviewLightningSpend = useCallback(async () => {
    if (!status?.enrolled || !enrollment) {
      setError('Sign in with the passkey that created this vault.')
      return
    }
    if (account !== 'spend') {
      setError('Lightning payments use Spending.')
      return
    }
    if (!vaultLightningSendEnabled()) {
      setError('Lightning send is not enabled in this release.')
      return
    }
    const profile = vaultLightningSolverProfile(status.network as NetworkName)
    if (!profile) {
      setError('No Lightning solver is configured for this network.')
      return
    }

    let invoice
    try {
      invoice = decodeVaultLightningInvoice(spend.address, profile.network)
    } catch (err) {
      setError(humanizeVaultError(err))
      return
    }
    if (invoice.amountSats > setup.txCapSats) {
      setError(`Over this device’s send limit of ${setup.txCapSats.toLocaleString()} sats. Use Savings.`)
      return
    }
    if (invoice.amountSats > vtxoSpendingSats) {
      setError('Not enough confirmed spending funds.')
      return
    }

    setBusy(true)
    try {
      const lightning = await import('../lib/vault/lightning')
      const phoneSecret = await unlockPhoneBip340(enrollment, status)
      let quote: VaultLightningQuote
      try {
        quote = await lightning.withVaultLightningSdkWallet(phoneSecret, status, vaultArkServer(), (session) =>
          lightning.withVaultLightningTransport(profile, (transport) =>
            lightning.requestVaultLightningQuote({
              wallet: session.wallet,
              arkServerUrl: vaultArkServer(),
              invoice: invoice.raw,
              network: profile.network,
              transport,
              repository: session.repository,
              contracts: session.contracts,
              manager: session.manager,
              profile,
            }),
          ),
        )
      } finally {
        zeroBytes(phoneSecret)
      }
      if (quote.fundAmountSats > setup.txCapSats) {
        throw new Error(`This payment exceeds the ${setup.txCapSats.toLocaleString()} sat send limit after fees.`)
      }
      const funding = await reserveVaultVtxo(enrollment, status, quote.fundAddress, quote.fundAmountSats)
      if (quote.fundAmountSats + funding.feeSats > vtxoSpendingSats) {
        throw new Error('Not enough confirmed spending funds after fees.')
      }
      if (spendRef.current.address.trim().replace(/^lightning:/i, '') !== invoice.raw) {
        throw new Error('Send details changed. Review the send again.')
      }
      setLightningQuote(quote)
      setReviewedVtxoQuote(funding)
      setSpend((current) =>
        current.address.trim().replace(/^lightning:/i, '') === invoice.raw
          ? { ...current, amount: quote.invoiceAmountSats, fee: quote.corridorFeeSats + funding.feeSats }
          : current,
      )
      setScreen('review')
    } catch (err) {
      setLightningQuote(null)
      setReviewedVtxoQuote(null)
      setError(humanizeVaultError(err))
    } finally {
      setBusy(false)
    }
  }, [account, enrollment, setup.txCapSats, spend.address, status, vtxoSpendingSats])

  const reviewSpend = useCallback(async () => {
    setError('')
    setReviewedVtxoQuote(null)
    if (!status?.enrolled) {
      setError('Unlock this vault before sending.')
      return
    }
    if (isVaultLightningInput(spend.address)) {
      await reviewLightningSpend()
      return
    }
    const destNetwork = status.network
    if (!isVaultSpendAddress(spend.address, destNetwork)) {
      setError('Enter an Arkade or Bitcoin address.')
      return
    }
    if (!Number.isInteger(spend.amount) || spend.amount < DUST_SATS) {
      setError('At least 330 sats.')
      return
    }
    const arkDestination = isVaultArkAddress(spend.address, destNetwork)
    if (arkDestination && account === 'savings') {
      setError('Savings sends require a Bitcoin address.')
      return
    }
    if (!arkDestination && account === 'spend' && status?.enrolled) {
      setError('Spending currently sends VTXOs to Arkade addresses. Bitcoin withdrawal is not in this rollout yet.')
      return
    }
    const source = account === 'savings' ? savingsSpendableSats : vtxoSpendingSats
    if (account !== 'savings') {
      if (spend.amount > setup.txCapSats) {
        setError(`Over this device’s send limit of ${setup.txCapSats.toLocaleString()} sats. Use Savings.`)
        return
      }
    }
    const preliminaryTotal = account === 'savings' ? spend.amount + spend.fee : spend.amount
    if (preliminaryTotal > source) {
      setError(account === 'savings' ? 'Not enough confirmed savings.' : 'Not enough confirmed spending funds.')
      return
    }
    if (account === 'savings' && spend.amount + spend.fee < source && source - (spend.amount + spend.fee) < DUST_SATS) {
      setError('Leave 330 sats of change, or send the rest.')
      return
    }
    if (account !== 'savings') {
      if (!enrollment) {
        setError('Sign in with the passkey that created this vault.')
        return
      }
      setBusy(true)
      try {
        const quote = await reserveVaultVtxo(enrollment, status, spend.address, spend.amount)
        if (
          spendRef.current.address.trim() !== quote.destAddress.trim() ||
          spendRef.current.amount !== quote.amountSats
        ) {
          setError('Send details changed. Review the send again.')
          return
        }
        setReviewedVtxoQuote(quote)
        setSpend((current) =>
          current.address === spend.address && current.amount === spend.amount
            ? { ...current, fee: quote.feeSats }
            : current,
        )
      } catch (err) {
        setError(humanizeVaultError(err))
        return
      } finally {
        setBusy(false)
      }
    }
    setScreen('review')
  }, [
    account,
    enrollment,
    reviewLightningSpend,
    savingsSpendableSats,
    setup.txCapSats,
    spend,
    status,
    vtxoSpendingSats,
  ])

  const finishBroadcast = useCallback(
    async (txid: string, kind: 'onchain' | 'vtxo' | 'lightning' = 'onchain', authoritativeFee?: number) => {
      setLastTxid(txid)
      setLastTxKind(kind)
      setLastSend(authoritativeFee === undefined ? spend : { ...spend, fee: authoritativeFee })
      setReviewedVtxoQuote(null)
      setLightningQuote(null)
      setSpend({ address: '', amount: 0, fee: vaultDraftFee(account, liveNetwork) })
      if (status?.vaultId) await refreshBalance(status.vaultId)
      setScreen('success')
    },
    [account, liveNetwork, refreshBalance, spend, status],
  )

  const approveSavingsSend = useCallback(async () => {
    if (!status?.enrolled || !enrollment || !savingsAddress) {
      throw new Error('Sign in with the passkey that created this vault.')
    }
    if (pendingSavingsHandoff) {
      throw new Error('Complete or cancel the Savings transfer waiting for hardware first.')
    }
    const need = spend.amount + spend.fee
    const utxos = await fetchAddressUtxos(savingsAddress)
    const coins = confirmedSpendables(utxos, need)
    if (coins.length === 0) throw new Error('Confirmed Savings funds do not cover this transfer.')
    const leaf = 'admin' as const
    if (spend.address === status.vtxoBoardingAddress) await verifyVaultBoarding(status)
    const unsigned = buildSavingsPsbt({
      status,
      phonePub: enrollment.phoneBip340Pub,
      destAddress: spend.address,
      amountSats: spend.amount,
      feeSats: spend.fee,
      coins: coins.map((coin) => ({
        txid: coin.txid,
        vout: coin.vout,
        value: coin.value,
        confirmedHeight: coin.status.block_height,
      })),
      leaf,
    })
    const secret = await unlockPhoneBip340(enrollment, status)
    try {
      const signed = signSavingsPsbt(unsigned, secret)
      const pending = createPendingSavingsHandoff({
        vaultId: status.vaultId,
        psbtHex: signed,
        destAddress: spend.address,
        amountSats: spend.amount,
        feeSats: spend.fee,
        network: status.network,
      })
      try {
        savePendingSavingsHandoff(localStorage, pending)
      } catch {
        throw new Error('This browser cannot save the pending Savings transfer. Use the installed wallet.')
      }
      setPendingSavingsHandoff(pending)
      setHandoffPsbt(signed)
      setScreen('handoff')
    } finally {
      zeroBytes(secret)
    }
  }, [enrollment, pendingSavingsHandoff, savingsAddress, spend, status])

  const discardPendingSavingsHandoff = useCallback(() => {
    const vaultId = pendingSavingsHandoff?.vaultId || status?.vaultId || ''
    if (vaultId) {
      try {
        clearPendingSavingsHandoff(localStorage, vaultId)
      } catch {
        // The active session can still discard its copy when storage is unavailable.
      }
    }
    setPendingSavingsHandoff(null)
    setHandoffPsbt('')
  }, [pendingSavingsHandoff?.vaultId, status?.vaultId])

  const cancelSavingsHandoff = useCallback(() => {
    discardPendingSavingsHandoff()
    setSpend({ address: '', amount: 0, fee: vaultDraftFee('savings', liveNetwork) })
    setError('')
    setAccount('savings')
    setScreen('home')
  }, [discardPendingSavingsHandoff, liveNetwork])

  const completeSavingsHandoff = useCallback(
    async (signedPsbt: string) => {
      setBusy(true)
      setError('')
      try {
        if (!pendingSavingsHandoff) throw new Error('the pending Savings transfer is missing')
        if (!handoffPsbt || handoffPsbt !== pendingSavingsHandoff.psbtHex) {
          throw new Error('the pending Savings transfer changed locally')
        }
        const incoming = parseIncomingPsbt(signedPsbt)
        requireSameSavingsIntent(
          pendingSavingsHandoff.psbtHex,
          incoming,
          pendingSavingsHandoff.destAddress,
          pendingSavingsHandoff.amountSats,
          pendingSavingsHandoff.network,
        )
        const final = finalizeSavingsPsbt(incoming)
        const txid = await broadcastTx(final.txHex)
        discardPendingSavingsHandoff()
        await finishBroadcast(txid)
      } catch (err) {
        setError(humanizeVaultError(err))
      } finally {
        setBusy(false)
      }
    },
    [discardPendingSavingsHandoff, finishBroadcast, handoffPsbt, pendingSavingsHandoff],
  )

  const approveSend = useCallback(async () => {
    setBusy(true)
    setError('')
    try {
      if (account === 'savings') {
        await approveSavingsSend()
        return
      }
      if (!status?.enrolled || !enrollment) {
        setError('Sign in with the passkey that created this vault.')
        return
      }
      if (!spendingArkAddress) {
        setError('No spending address yet.')
        return
      }
      if (lightningQuote) {
        if (boardingInProgress) {
          setError('Spending is still boarding Bitcoin. Try again in a moment.')
          return
        }
        const lightning = await import('../lib/vault/lightning')
        lightning.assertVaultLightningQuoteCurrent(lightningQuote)
        const reviewed = reviewedVtxoQuote
        const expectedFee = lightningQuote.corridorFeeSats + (reviewed?.feeSats ?? 0)
        if (
          !reviewed ||
          reviewed.destAddress !== lightningQuote.fundAddress ||
          reviewed.amountSats !== lightningQuote.fundAmountSats ||
          spend.address.trim().replace(/^lightning:/i, '') !== lightningQuote.invoice ||
          spend.amount !== lightningQuote.invoiceAmountSats ||
          spend.fee !== expectedFee
        ) {
          setReviewedVtxoQuote(null)
          setLightningQuote(null)
          setError('This Lightning quote expired or changed. Review the payment again.')
          setScreen('send')
          return
        }
        try {
          await lightning.withVaultLightningRepository(status.vaultId, async (repository) => {
            const target = await lightning.beginVaultLightningFunding(repository, lightningQuote.rfqId)
            if (target.address !== reviewed.destAddress || target.amountSats !== reviewed.amountSats) {
              throw new Error('Lightning funding target changed after Review.')
            }
            try {
              const result = await sendVaultVtxo(enrollment, status, reviewed)
              await lightning.recordVaultLightningFundingTxid(repository, lightningQuote.rfqId, result.txid)
              await finishBroadcast(result.txid, 'lightning', expectedFee)
            } catch (err) {
              if (isVtxoReceiptPendingError(err)) {
                await lightning.recordVaultLightningFundingTxid(repository, lightningQuote.rfqId, err.txid)
                await finishBroadcast(err.txid, 'lightning', expectedFee)
                return
              }
              throw err
            }
          })
          return
        } catch (err) {
          if (isVtxoReviewedReservationError(err)) {
            setReviewedVtxoQuote(null)
            setLightningQuote(null)
            setSpend((current) => ({ ...current, fee: vaultDraftFee('spend', liveNetwork) }))
            setError(humanizeVaultError(err))
            setScreen('send')
            return
          }
          if (status.vaultId) await refreshBalance(status.vaultId)
          if (isVtxoSpendInFlightError(err)) {
            setError(humanizeVaultError(err))
            setScreen('home')
            return
          }
          throw err
        }
      }
      if (spendingArkAddress && isVaultArkAddress(spend.address, status.network) && vtxoSpendingSats >= spend.amount) {
        if (boardingInProgress) {
          setError('Spending is still boarding Bitcoin. Try again in a moment.')
          return
        }
        const reviewed = reviewedVtxoQuote
        if (!reviewed || !reviewedVtxoQuoteMatchesDraft(reviewed, spend)) {
          setReviewedVtxoQuote(null)
          setSpend((current) => ({ ...current, fee: vaultDraftFee('spend', liveNetwork) }))
          setError('This fee quote expired or changed. Review the send again.')
          setScreen('send')
          return
        }
        try {
          const result = await sendVaultVtxo(enrollment, status, reviewed)
          await finishBroadcast(result.txid, 'vtxo', result.feeSats)
          return
        } catch (err) {
          if (isVtxoReceiptPendingError(err)) {
            await finishBroadcast(err.txid, 'vtxo', err.feeSats)
            return
          }
          if (isVtxoReviewedReservationError(err)) {
            setReviewedVtxoQuote(null)
            setSpend((current) => ({ ...current, fee: vaultDraftFee('spend', liveNetwork) }))
            setError(humanizeVaultError(err))
            setScreen('send')
            return
          }
          if (status.vaultId) await refreshBalance(status.vaultId)
          if (isVtxoSpendInFlightError(err)) {
            setError(humanizeVaultError(err))
            setScreen('home')
            return
          }
          throw err
        }
      }
      setError('Vault isn’t ready to send.')
    } catch (err) {
      setError(humanizeVaultError(err))
    } finally {
      setBusy(false)
    }
  }, [
    account,
    approveSavingsSend,
    boardingInProgress,
    enrollment,
    finishBroadcast,
    lightningQuote,
    liveNetwork,
    refreshBalance,
    reviewedVtxoQuote,
    spend,
    spendingArkAddress,
    status,
    vtxoSpendingSats,
  ])

  const reset = useCallback(() => {
    setSessionLocked(true)
    setLocked(true)
    setError('')
    setSpend({ address: '', amount: 0, fee: 0 })
    setReviewedVtxoQuote(null)
    setLightningQuote(null)
    setLastSend(null)
    setLastTxid('')
    setLastTxKind('')
    setAccount('spend')
    setScanOnSend(false)
    setHandoffPsbt('')
    setScreen('welcome')
  }, [])

  const retryLightningRefund = useCallback(
    async (rfqId: string) => {
      setBusy(true)
      setError('')
      let phoneSecret: Uint8Array | undefined
      try {
        if (!status?.enrolled || !enrollment) throw new Error('Sign in before returning this payment.')
        const lightning = await import('../lib/vault/lightning')
        phoneSecret = await unlockPhoneBip340(enrollment, status)
        await lightning.withVaultLightningSdkWallet(
          phoneSecret,
          status,
          vaultArkServer(),
          async (session) => {
            const record = await lightning.getVaultLightningStatus(session.repository, rfqId)
            if (!record) throw new Error('This Lightning payment is no longer available.')
            if (record.state === 'refunded' || record.state === 'settled') return
            if (record.state === 'needs_counterparty') {
              throw new Error('The Lightning payment could not be returned yet. Try again shortly.')
            }
            if (record.state === 'failed') {
              throw new Error('The Lightning payment needs recovery before it can be returned.')
            }
            throw new Error('This Lightning payment is still processing.')
          },
          { requiredRfqId: rfqId },
        )
        await refreshBalance(status.vaultId)
      } catch (err) {
        setError(humanizeVaultError(err))
      } finally {
        zeroBytes(phoneSecret as Uint8Array)
        setBusy(false)
      }
    },
    [enrollment, refreshBalance, status],
  )

  const value = useMemo<VaultContextProps>(
    () => ({
      acceptDesign,
      account,
      amountSats,
      applyHardware,
      applyRecovery,
      skipRecovery,
      downloadRecoveryKit,
      backupRecoveryKit,
      balanceError,
      balancesLoaded,
      boardingAddress,
      boardingInProgress,
      restoreRecoveryKit,
      signGuardianExitWithDevice,
      hasRecoveryKit,
      initiateAlert,
      initiateAlerts,
      approveSend,
      busy,
      canSend: vtxoSpendingSats >= DUST_SATS,
      cancelSavingsHandoff,
      completeSavingsHandoff,
      handoffPsbt,
      confirmConditions,
      dailyLimit,
      dailyRemaining,
      dailySpent: status?.enrolled ? (status.periodSpent ?? 0) : Math.max(0, dailyLimit - dailyRemaining),
      enablePasskeyLogin: enableOtherDevices,
      enroll,
      enrolled,
      error,
      finishPlan,
      hasLocalEnrollment: Boolean(enrollment),
      locked,
      lastTxid,
      lastTxKind,
      history: recentAccountHistory(visibleHistory, account),
      selectedTx,
      openTx: (tx) => {
        if (tx.activity === 'savings-handoff' && pendingSavingsHandoff) {
          setAccount('savings')
          setSpend({
            address: pendingSavingsHandoff.destAddress,
            amount: pendingSavingsHandoff.amountSats,
            fee: pendingSavingsHandoff.feeSats,
          })
          setHandoffPsbt(pendingSavingsHandoff.psbtHex)
          setError('')
          setScreen('handoff')
          return
        }
        setSelectedTx(tx)
        setError('')
        setScreen('tx')
      },
      liveNetwork,
      navigate: (next) => {
        setError('')
        setScreen(next)
      },
      openRecover: (view = 'kit', exit = 'keys') => {
        setError('')
        setRecoverEntry(view)
        setRecoverExit(exit)
        setScreen('recover')
      },
      recoverEntry,
      recoverExit,
      networkLabel,
      spendingArkAddress,
      refreshBalance,
      retryLightningRefund,
      refreshingBalance,
      reset,
      reviewSpend,
      openSendScan: () => {
        selectAccount('spend')
        setScanOnSend(true)
        setError('')
        setScreen('send')
      },
      scanOnSend,
      clearSendScan: () => setScanOnSend(false),
      savingsAddress,
      savingsSats,
      savingsSpendableSats,
      screen: loaded ? screen : 'welcome',
      setAccount: selectAccount,
      setSpendDraft,
      setup,
      signIn,
      spend,
      status,
      lastSend,
      vtxoSpendingSats,
    }),
    [
      acceptDesign,
      account,
      amountSats,
      applyHardware,
      applyRecovery,
      skipRecovery,
      downloadRecoveryKit,
      backupRecoveryKit,
      balanceError,
      balancesLoaded,
      boardingAddress,
      boardingInProgress,
      restoreRecoveryKit,
      signGuardianExitWithDevice,
      hasRecoveryKit,
      initiateAlert,
      initiateAlerts,
      approveSend,
      busy,
      cancelSavingsHandoff,
      completeSavingsHandoff,
      confirmConditions,
      handoffPsbt,
      dailyLimit,
      dailyRemaining,
      enableOtherDevices,
      enrollment,
      enroll,
      signIn,
      enrolled,
      error,
      finishPlan,
      lastTxid,
      lastTxKind,
      visibleHistory,
      pendingSavingsHandoff,
      selectedTx,
      liveNetwork,
      locked,
      lastSend,
      recoverEntry,
      recoverExit,
      loaded,
      networkLabel,
      spendingArkAddress,
      recoverEntry,
      recoverExit,
      refreshBalance,
      retryLightningRefund,
      refreshingBalance,
      reset,
      reviewSpend,
      scanOnSend,
      savingsAddress,
      savingsSats,
      savingsSpendableSats,
      screen,
      selectAccount,
      setSpendDraft,
      setup,
      spend,
      status?.enrolled,
      status?.periodSpent,
      vtxoSpendingSats,
    ],
  )

  return <VaultContext.Provider value={value}>{children}</VaultContext.Provider>
}
