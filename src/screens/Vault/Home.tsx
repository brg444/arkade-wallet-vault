import { useContext, useEffect } from 'react'
import { ArrowDownLeft, ArrowUpRight, ChevronRight, Clock3, QrCode, ScanLine, Shield, ShieldAlert } from 'lucide-react'
import { prettyNumber } from '../../lib/format'
import { hapticLight, hapticSubtle } from '../../lib/haptics'
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
    navigate,
    openSendScan,
    openRecover,
    initiateAlert,
    refreshBalance,
    refreshingBalance,
    positions,
    clearSpendDraft,
    setSpendDraft,
  } = useContext(VaultContext)

  useEffect(() => {
    void reloadIfNewerWallet()
    const onFocus = () => {
      void reloadIfNewerWallet()
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])

  const spending = account === 'spend'
  const position = spending ? positions.spending : positions.savings
  const sats = position.totalSats
  const satsUnit = sats === 1 ? 'SAT' : 'SATS'

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
              aria-label={spending ? 'Receive to Spending' : 'Add to Savings'}
              data-testid='account-receive'
              onClick={() => navigate('receive')}
            >
              <QrCode />
            </button>
          </div>
        </header>

        <section
          className='qg-balance'
          data-testid='vault-balance'
          aria-busy={(!balancesLoaded && !balanceError) || refreshingBalance}
          aria-live='polite'
          aria-label={
            balancesLoaded
              ? `${spending ? 'Spending' : 'Savings'} balance: ${prettyNumber(sats)} ${satsUnit}`
              : `${spending ? 'Spending' : 'Savings'} balance loading`
          }
        >
          <strong>{balancesLoaded ? prettyNumber(sats) : '—'}</strong>
          {balancesLoaded ? <span>{satsUnit}</span> : null}
        </section>
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
              <b>{spending ? 'Send' : 'Move to Spending'}</b>
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
              <b>{spending ? 'Receive' : 'Add to Savings'}</b>
            </span>
          </button>
        </div>

        {balancesLoaded && spending && positions.spending.pendingSats > 0 ? (
          <section className='qg-arrival' aria-label='Funds arriving' data-testid='spending-pending'>
            <span className='qg-status-icon' aria-hidden>
              <Clock3 />
            </span>
            <div>
              <strong>{prettyNumber(positions.spending.pendingSats)} sats arriving</strong>
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
              <strong>{prettyNumber(positions.savings.pendingSats)} sats pending</strong>
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
