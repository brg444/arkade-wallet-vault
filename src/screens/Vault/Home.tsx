import { Menu } from '@base-ui/react/menu'
import { useContext, useEffect, useRef } from 'react'
import Button from '../../components/Button'
import Content from './Content'
import ErrorMessage from '../../components/Error'
import Text from '../../components/Text'
import { useToast } from '../../components/Toast'
import SmallLogo from '../../components/SmallLogo'
import ChevronDownIcon from '../../icons/ChevronDown'
import QrIcon from '../../icons/Qr'
import ReceiveIcon from '../../icons/Receive'
import ScanIcon from '../../icons/Scan'
import SendIcon from '../../icons/Send'
import { copyToClipboard } from '../../lib/clipboard'
import { prettyNumber } from '../../lib/format'
import { hapticSubtle } from '../../lib/haptics'
import { truncateAddress } from '../../lib/vault/policy'
import { reloadIfNewerWallet } from '../../lib/vault/update'
import { VaultContext, type VaultAccount } from '../../vault/context'
import VaultHistory from './History'
import { Meter } from './ui'

function fundableAddress(value: string): string {
  if (!value || value.startsWith('bcrt1')) return ''
  return value
}

export default function VaultHome() {
  const {
    account,
    balanceError,
    balancesLoaded,
    boardingAddress,
    canSend,
    dailyLimit,
    dailyRemaining,
    error,
    navigate,
    openSendScan,
    openRecover,
    initiateAlert,
    refreshBalance,
    spendingArkAddress,
    refreshingBalance,
    savingsAddress,
    positions,
    setAccount,
    setSpendDraft,
  } = useContext(VaultContext)
  const { toast } = useToast()
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
  const address = spending ? spendingArkAddress : fundableAddress(savingsAddress)
  const used = Math.max(0, dailyLimit - dailyRemaining)
  const ratio = dailyLimit > 0 ? Math.min(1, used / dailyLimit) : 0
  const satsUnit = sats === 1 ? 'SAT' : 'SATS'

  const choose = (next: VaultAccount) => {
    hapticSubtle()
    setAccount(next)
  }

  return (
    <Content className='vault-home-content'>
      <div className='vault-home'>
        <section className='vault-home-hero'>
          <div className='vault-home-hero-inner'>
            <div className='vault-account-bar'>
              <div className='vault-account-lead'>
                <Menu.Root
                  onOpenChangeComplete={(open) => {
                    if (open) (spending ? spendingItem : savingsItem).current?.focus()
                  }}
                >
                  <Menu.Trigger
                    type='button'
                    className='vault-account-switch'
                    data-testid='account-switcher'
                    onClick={hapticSubtle}
                  >
                    <span className='vault-account-logo' aria-hidden>
                      <SmallLogo />
                    </span>
                    <span className='vault-account-index'>{spending ? '1/2' : '2/2'}</span>
                    <span className='vault-account-name'>{spending ? 'Spending' : 'Savings'}</span>
                    <span className='vault-account-chevron'>
                      <ChevronDownIcon />
                    </span>
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
                {address ? (
                  <button
                    type='button'
                    className='vault-account-addr'
                    data-testid='account-address'
                    onClick={() => {
                      void copyToClipboard(address)
                      toast('Address copied')
                    }}
                  >
                    {truncateAddress(address, 6)}
                  </button>
                ) : null}
              </div>
              <div className='vault-account-actions'>
                <button
                  type='button'
                  className='vault-account-qr'
                  aria-label={spending ? 'Scan a Spending payment' : 'Scan a Savings destination'}
                  data-testid='account-scan'
                  onClick={() => {
                    hapticSubtle()
                    openSendScan()
                  }}
                >
                  <ScanIcon />
                </button>
                <button
                  type='button'
                  className='vault-account-qr'
                  aria-label={spending ? 'Receive to Spending' : 'Add to Savings'}
                  data-testid='account-receive'
                  onClick={() => navigate('receive')}
                >
                  <QrIcon />
                </button>
              </div>
            </div>
            <div className='vault-home-balance'>
              <p className='vault-balance-label'>{spending ? 'Available to spend' : 'Savings balance'}</p>
              <p
                className='vault-balance-figure'
                data-testid='vault-balance'
                aria-busy={(!balancesLoaded && !balanceError) || refreshingBalance}
                aria-live='polite'
              >
                {balancesLoaded ? prettyNumber(sats) : '—'}
                {balancesLoaded ? <span className='vault-balance-unit'>{satsUnit}</span> : null}
              </p>
              {!balancesLoaded ? (
                balanceError ? null : (
                  <Text color='neutral-600' tiny wrap>
                    Loading {spending ? 'Spending' : 'Savings'} balance…
                  </Text>
                )
              ) : spending ? (
                <div className='vault-home-limit'>
                  <Text color='neutral-600' tiny>
                    {prettyNumber(dailyRemaining, 0)} remaining of {prettyNumber(dailyLimit, 0)} in your rolling 24-hour
                    limit
                  </Text>
                  <Meter ratio={ratio} label='Rolling 24-hour limit used' />
                </div>
              ) : (
                <Text color='neutral-600' tiny wrap>
                  Moving funds requires this device and your hardware key.
                </Text>
              )}
            </div>
            <div className='vault-home-actions'>
              <Button
                main
                className='vault-home-action-send'
                icon={<SendIcon />}
                label={spending ? 'Send' : 'Move to Spending'}
                disabled={spending ? !canSend : positions.savings.availableSats <= 330}
                onClick={() => {
                  if (!spending && boardingAddress) setSpendDraft({ address: boardingAddress })
                  navigate('send')
                }}
              />
              <Button
                main
                className='vault-home-action-receive'
                icon={<ReceiveIcon />}
                label={spending ? 'Receive' : 'Add to Savings'}
                onClick={() => navigate('receive')}
              />
            </div>
          </div>
        </section>

        <section className='vault-home-sheet'>
          <div className='vault-home-sheet-inner'>
            {balancesLoaded && spending && positions.spending.pendingSats > 0 ? (
              <div className='vault-status-card is-active' role='status' data-testid='spending-pending'>
                <span className='vault-status-icon' aria-hidden>
                  <ReceiveIcon />
                </span>
                <span className='vault-status-content'>
                  <span className='vault-status-label'>
                    {prettyNumber(positions.spending.pendingSats)} sats · Arriving via Bitcoin
                  </span>
                  <span className='vault-status-copy'>Available after confirmation and automatic boarding.</span>
                  <span className='vault-status-total' data-testid='spending-total'>
                    Total in Spending: {prettyNumber(positions.spending.totalSats)} sats
                  </span>
                </span>
              </div>
            ) : null}

            {balancesLoaded && !spending && positions.savings.pendingSats > 0 ? (
              <div className='vault-status-card is-active' role='status' data-testid='savings-pending'>
                <span className='vault-status-icon' aria-hidden>
                  <ReceiveIcon />
                </span>
                <span className='vault-status-content'>
                  <span className='vault-status-label'>
                    {prettyNumber(positions.savings.availableSats)} sats available to move
                  </span>
                  <span className='vault-status-copy'>
                    {prettyNumber(positions.savings.pendingSats)} sats are waiting for Bitcoin confirmation.
                  </span>
                </span>
              </div>
            ) : null}

            {initiateAlert ? (
              <button
                type='button'
                className='vault-status-card is-warning'
                data-testid='initiate-alert'
                onClick={() => openRecover('lost', 'home')}
              >
                <span className='vault-status-icon' aria-hidden>
                  !
                </span>
                <span className='vault-status-content'>
                  <span className='vault-status-label'>Recovery in process</span>
                  <span className='vault-status-copy'>
                    {initiateAlert} Open Recovery to review the available cancellation paths.
                  </span>
                </span>
              </button>
            ) : null}

            <ErrorMessage error={Boolean(error || balanceError)} text={error || balanceError} />
            {balanceError ? (
              <Button secondary label='Retry' loading={refreshingBalance} onClick={() => void refreshBalance()} />
            ) : null}
            <VaultHistory />
          </div>
        </section>
      </div>
    </Content>
  )
}
