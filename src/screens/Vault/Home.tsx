import { Menu } from '@base-ui/react/menu'
import { useContext, useEffect, useRef } from 'react'
import {
  ArrowDownLeft,
  ArrowUpRight,
  ChevronDown,
  ChevronRight,
  Clock3,
  QrCode,
  ScanLine,
  Shield,
  ShieldAlert,
} from 'lucide-react'
import ErrorMessage from '../../components/Error'
import { prettyNumber } from '../../lib/format'
import { hapticSubtle } from '../../lib/haptics'
import { reloadIfNewerWallet } from '../../lib/vault/update'
import { VaultContext, type VaultAccount } from '../../vault/context'
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
    setAccount,
    setSpendDraft,
  } = useContext(VaultContext)
  const spendingItem = useRef<HTMLElement>(null)
  const savingsItem = useRef<HTMLElement>(null)

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
  const sats = spending ? position.availableSats : position.totalSats
  const satsUnit = sats === 1 ? 'SAT' : 'SATS'

  const choose = (next: VaultAccount) => {
    hapticSubtle()
    setAccount(next)
  }

  return (
    <Content className='qg-home-content'>
      <main className='qg-home'>
        <header className='qg-account-bar vault-account-bar'>
          <Menu.Root
            onOpenChangeComplete={(open) => {
              if (open) (spending ? spendingItem : savingsItem).current?.focus()
            }}
          >
            <Menu.Trigger type='button' className='qg-account' data-testid='account-switcher' onClick={hapticSubtle}>
              <QgMark />
              <small>{spending ? '1/2' : '2/2'}</small>
              <strong>{spending ? 'Spending' : 'Savings'}</strong>
              <ChevronDown />
            </Menu.Trigger>
            <Menu.Portal>
              <Menu.Positioner className='vault-account-positioner' sideOffset={8} align='start'>
                <Menu.Popup className='vault-account-menu' aria-label='Accounts'>
                  <Menu.RadioGroup value={account} onValueChange={(value) => choose(value as VaultAccount)}>
                    <Menu.RadioItem
                      ref={spendingItem}
                      value='spend'
                      closeOnClick
                      className={spending ? 'vault-account-option is-on' : 'vault-account-option'}
                      data-testid='account-spend'
                    >
                      <span>
                        <span className='vault-account-option-name'>Spending</span>
                        <span className='vault-account-option-meta'>This device, within your limits</span>
                      </span>
                      <span className='vault-account-option-amt'>
                        {balancesLoaded
                          ? `${prettyNumber(positions.spending.availableSats)} ${positions.spending.availableSats === 1 ? 'SAT' : 'SATS'} available`
                          : 'Loading…'}
                      </span>
                    </Menu.RadioItem>
                    <Menu.RadioItem
                      ref={savingsItem}
                      value='savings'
                      closeOnClick
                      className={!spending ? 'vault-account-option is-on' : 'vault-account-option'}
                      data-testid='account-savings'
                    >
                      <span>
                        <span className='vault-account-option-name'>Savings</span>
                        <span className='vault-account-option-meta'>This device and hardware</span>
                      </span>
                      <span className='vault-account-option-amt'>
                        {balancesLoaded
                          ? `${prettyNumber(positions.savings.totalSats)} ${positions.savings.totalSats === 1 ? 'SAT' : 'SATS'} total`
                          : 'Loading…'}
                      </span>
                    </Menu.RadioItem>
                  </Menu.RadioGroup>
                </Menu.Popup>
              </Menu.Positioner>
            </Menu.Portal>
          </Menu.Root>
          <div className='qg-utilities'>
            <button
              type='button'
              className={initiateAlert ? 'qg-recovery-shortcut needs-attention' : 'qg-recovery-shortcut'}
              aria-label='Open Recovery'
              data-testid='account-recovery'
              onClick={() => openRecover('lost', 'home')}
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
        {!spending && balancesLoaded && positions.savings.availableSats !== positions.savings.totalSats ? (
          <p className='qg-helper'>{prettyNumber(positions.savings.availableSats)} sats currently spendable</p>
        ) : null}

        <div className='qg-actions'>
          <button
            type='button'
            disabled={spending ? !canSend : positions.savings.availableSats <= 330}
            onClick={() => {
              if (!spending && boardingAddress) setSpendDraft({ address: boardingAddress })
              navigate('send')
            }}
          >
            <span>
              <ArrowUpRight />
              <b>{spending ? 'Send' : 'Move to Spending'}</b>
            </span>
          </button>
          <button type='button' onClick={() => navigate('receive')}>
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
              <small data-testid='spending-total'>{prettyNumber(positions.spending.totalSats)} sats total</small>
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

        <ErrorMessage error={Boolean(error || balanceError)} text={error || balanceError} />
        {balanceError ? (
          <button type='button' className='qg-secondary' onClick={() => void refreshBalance()}>
            Retry
          </button>
        ) : null}
        <VaultHistory />
      </main>
    </Content>
  )
}
