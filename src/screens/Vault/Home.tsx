import { useContext, useEffect, useState } from 'react'
import { ArrowDownLeft, ArrowUpRight, ChevronRight, Clock3, QrCode, ScanLine, Shield, ShieldAlert } from 'lucide-react'
import { useToast } from '../../components/Toast'
import { prettyNumber } from '../../lib/format'
import { hapticLight, hapticSubtle } from '../../lib/haptics'
import { homeBalanceDisplay, type VaultFiatDisplayRate } from '../../lib/vault/fiatDisplay'
import { loadVaultBalanceUnit, saveVaultBalanceUnit } from '../../lib/vault/prefs'
import { reloadIfNewerWallet } from '../../lib/vault/update'
import { VaultContext } from '../../vault/context'
import Content from './Content'
import VaultHistory from './History'
import { QgMark } from './qg/QgScreen'

export default function VaultHome() {
  const {
    account,
    balanceError,
    balancesLoaded,
    boardingAddress,
    canSend,
    error,
    fiatDisplayRate,
    navigate,
    openSendScan,
    openRecover,
    initiateAlert,
    refreshBalance,
    refreshingBalance,
    positions,
    clearSpendDraft,
    setSpendDraft,
    setFiatDisplay,
  } = useContext(VaultContext)
  const { toast } = useToast()

  useEffect(() => {
    void reloadIfNewerWallet()
    const onFocus = () => {
      void reloadIfNewerWallet()
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])

  const [balanceUnit, setBalanceUnit] = useState<'sats' | 'usd'>('sats')
  const [loadingFiat, setLoadingFiat] = useState(false)
  const [homeFiatRate, setHomeFiatRate] = useState<VaultFiatDisplayRate | null>(fiatDisplayRate)

  useEffect(() => {
    if (fiatDisplayRate) setHomeFiatRate(fiatDisplayRate)
  }, [fiatDisplayRate])

  useEffect(() => {
    let active = true
    let preferred: 'sats' | 'usd' = 'sats'
    try {
      preferred = loadVaultBalanceUnit()
    } catch {
      return
    }
    if (preferred !== 'usd') return
    setLoadingFiat(true)
    void setFiatDisplay(true)
      .then((rate) => {
        if (!active) return
        if (rate) {
          setHomeFiatRate(rate)
          setBalanceUnit('usd')
        } else saveVaultBalanceUnit('sats')
      })
      .finally(() => {
        if (active) setLoadingFiat(false)
      })
    return () => {
      active = false
    }
  }, [setFiatDisplay])
  const spending = account === 'spend'
  const position = spending ? positions.spending : positions.savings
  const sats = position.totalSats
  const balance = homeBalanceDisplay(sats, balanceUnit, fiatDisplayRate || homeFiatRate)

  const toggleBalanceUnit = async () => {
    if (!balancesLoaded || loadingFiat) return
    hapticSubtle()
    if (balanceUnit === 'usd') {
      setBalanceUnit('sats')
      setHomeFiatRate(null)
      saveVaultBalanceUnit('sats')
      await setFiatDisplay(false)
      return
    }
    setLoadingFiat(true)
    try {
      const rate = fiatDisplayRate || (await setFiatDisplay(true))
      if (!rate) {
        toast('USD balance is unavailable. Try again later.')
        return
      }
      setHomeFiatRate(rate)
      setBalanceUnit('usd')
      saveVaultBalanceUnit('usd')
    } finally {
      setLoadingFiat(false)
    }
  }

  return (
    <Content className='qg-home-content'>
      <main className='qg-home'>
        <header className='qg-account-bar vault-account-bar'>
          <div className='qg-account' data-testid='account-switcher'>
            <QgMark />
            <strong>{spending ? 'Spending' : 'Savings'}</strong>
          </div>
          <div className='qg-utilities'>
            <button
              type='button'
              className={initiateAlert ? 'qg-recovery-shortcut needs-attention' : 'qg-recovery-shortcut'}
              aria-label='Open Recovery'
              data-testid='account-recovery'
              onClick={() => {
                hapticSubtle()
                openRecover('lost', 'home')
              }}
            >
              <Shield />
              {initiateAlert ? <span aria-hidden='true' /> : null}
            </button>
            <i className='qg-utility-divider' aria-hidden='true' />
            <button
              type='button'
              aria-label={spending ? 'Scan a Spending payment' : 'Scan a Savings destination'}
              data-testid='account-scan'
              onClick={() => {
                hapticSubtle()
                openSendScan()
              }}
            >
              <ScanLine />
            </button>
            <button
              type='button'
              aria-label={spending ? 'Receive to Spending' : 'Deposit'}
              data-testid='account-receive'
              onClick={() => navigate('receive')}
            >
              <QrCode />
            </button>
          </div>
        </header>

        <button
          type='button'
          className='qg-balance'
          data-testid='vault-balance'
          data-balance-unit={balanceUnit}
          disabled={!balancesLoaded || loadingFiat}
          aria-busy={(!balancesLoaded && !balanceError) || refreshingBalance || loadingFiat ? true : undefined}
          aria-live='polite'
          aria-label={
            balancesLoaded
              ? `${spending ? 'Spending' : 'Savings'} balance: ${balance.label}. Show ${
                  balanceUnit === 'usd' ? 'bitcoin' : 'USD'
                }`
              : `${spending ? 'Spending' : 'Savings'} balance loading`
          }
          onClick={() => void toggleBalanceUnit()}
        >
          <strong>{balancesLoaded ? balance.amount : '—'}</strong>
          {balancesLoaded && balance.unit ? <span>{balance.unit}</span> : null}
        </button>
        <div className='qg-actions'>
          <button
            type='button'
            disabled={spending ? !canSend : positions.savings.availableSats <= 330}
            onClick={() => {
              hapticLight()
              clearSpendDraft()
              if (!spending && boardingAddress) setSpendDraft({ address: boardingAddress })
              navigate('send')
            }}
          >
            <span>
              <ArrowUpRight />
              <b>{spending ? 'Send' : 'Spending'}</b>
            </span>
          </button>
          <button
            type='button'
            onClick={() => {
              hapticLight()
              navigate('receive')
            }}
          >
            <span>
              <ArrowDownLeft />
              <b>{spending ? 'Receive' : 'Deposit'}</b>
            </span>
          </button>
        </div>

        {balancesLoaded && spending && positions.spending.pendingSats > 0 ? (
          <section className='qg-arrival' aria-label='Funds arriving' data-testid='spending-pending'>
            <span className='qg-status-icon' aria-hidden>
              <Clock3 />
            </span>
            <div>
              <strong>{prettyNumber(positions.spending.pendingSats)} ₿SATS arriving</strong>
              <p>Available after Bitcoin confirmation.</p>
            </div>
          </section>
        ) : null}

        {balancesLoaded && !spending && positions.savings.pendingSats > 0 ? (
          <section className='qg-arrival' aria-label='Funds pending' data-testid='savings-pending'>
            <span className='qg-status-icon' aria-hidden>
              <Clock3 />
            </span>
            <div>
              <strong>{prettyNumber(positions.savings.pendingSats)} ₿SATS pending</strong>
              <p>Waiting for Bitcoin confirmation.</p>
            </div>
          </section>
        ) : null}

        {initiateAlert ? (
          <button
            type='button'
            className='qg-recovery-alert'
            data-testid='initiate-alert'
            onClick={() => openRecover('lost', 'home')}
          >
            <span>
              <ShieldAlert />
            </span>
            <div>
              <strong>Recovery started with hardware</strong>
              <p>Open Recovery to review the available cancellation paths.</p>
            </div>
            <ChevronRight />
          </button>
        ) : null}

        {!balancesLoaded && (error || balanceError) ? (
          <>
            <p className='qg-copy' role='alert'>
              {error || balanceError}
            </p>
            {balanceError ? (
              <button type='button' className='qg-secondary' onClick={() => void refreshBalance()}>
                Retry
              </button>
            ) : null}
          </>
        ) : null}
        <VaultHistory />
      </main>
    </Content>
  )
}
