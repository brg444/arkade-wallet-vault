import { useContext, useEffect, useState } from 'react'
import Button from '../../components/Button'
import Content from './Content'
import ErrorMessage from '../../components/Error'
import FlexCol from '../../components/FlexCol'
import FlexRow from '../../components/FlexRow'
import Padded from '../../components/Padded'
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
    amountSats,
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
    liveNetwork,
    initiateAlert,
    refreshBalance,
    spendingArkAddress,
    refreshingBalance,
    savingsAddress,
    savingsSats,
    setAccount,
    setSpendDraft,
    status,
  } = useContext(VaultContext)
  const { toast } = useToast()
  const [picker, setPicker] = useState(false)

  useEffect(() => {
    void reloadIfNewerWallet()
    const onFocus = () => {
      void reloadIfNewerWallet()
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])

  const spending = account === 'spend'
  const sats = spending ? amountSats : savingsSats
  const address = spending ? spendingArkAddress : fundableAddress(savingsAddress)
  const used = Math.max(0, dailyLimit - dailyRemaining)
  const ratio = dailyLimit > 0 ? Math.min(1, used / dailyLimit) : 0
  const satsUnit = sats === 1 ? 'SAT' : 'SATS'

  const choose = (next: VaultAccount) => {
    setAccount(next)
    setPicker(false)
  }

  return (
    <>
      <Content>
        <Padded>
          <div className='vault-home'>
            <div className='vault-account-bar'>
              <div className='vault-account-lead'>
                <button
                  type='button'
                  className='vault-account-switch'
                  data-testid='account-switcher'
                  aria-haspopup='listbox'
                  aria-expanded={picker}
                  onClick={() => {
                    hapticSubtle()
                    setPicker((open) => !open)
                  }}
                >
                  <span className='vault-account-logo' aria-hidden>
                    <SmallLogo />
                  </span>
                  <span className='vault-account-index'>{spending ? '1/2' : '2/2'}</span>
                  <span className='vault-account-name'>{spending ? 'Spending' : 'Savings'}</span>
                  <span className='vault-account-chevron'>
                    <ChevronDownIcon />
                  </span>
                </button>
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
                ) : (
                  <p className='vault-account-addr is-empty'>{liveNetwork ? 'Testnet' : 'No address yet'}</p>
                )}
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
            {picker ? (
              <>
                <button
                  type='button'
                  className='vault-account-dismiss'
                  aria-label='Close accounts'
                  onClick={() => setPicker(false)}
                />
                <div className='vault-account-menu' role='listbox'>
                  <button
                    type='button'
                    role='option'
                    aria-selected={spending}
                    className={spending ? 'vault-account-option is-on' : 'vault-account-option'}
                    data-testid='account-spend'
                    onClick={() => choose('spend')}
                  >
                    <span>
                      <span className='vault-account-option-name'>Spending</span>
                      <span className='vault-account-option-meta'>This device, up to today’s limit</span>
                    </span>
                    <span className='vault-account-option-amt'>
                      {balancesLoaded ? `${prettyNumber(amountSats)} ${amountSats === 1 ? 'SAT' : 'SATS'}` : 'Loading…'}
                    </span>
                  </button>
                  <button
                    type='button'
                    role='option'
                    aria-selected={!spending}
                    className={!spending ? 'vault-account-option is-on' : 'vault-account-option'}
                    data-testid='account-savings'
                    onClick={() => choose('savings')}
                  >
                    <span>
                      <span className='vault-account-option-name'>Savings</span>
                      <span className='vault-account-option-meta'>This device and hardware</span>
                    </span>
                    <span className='vault-account-option-amt'>
                      {balancesLoaded
                        ? `${prettyNumber(savingsSats)} ${savingsSats === 1 ? 'SAT' : 'SATS'}`
                        : 'Loading…'}
                    </span>
                  </button>
                </div>
              </>
            ) : null}

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
              <FlexCol gap='0.35rem'>
                <Text color='neutral-600' tiny>
                  {prettyNumber(dailyRemaining, 0)} / {prettyNumber(dailyLimit, 0)} remaining in the rolling 24h limit
                </Text>
                <Meter ratio={ratio} label='Daily limit used' />
              </FlexCol>
            ) : (
              <Text color='neutral-600' tiny wrap>
                Confirmed and unspent. Moving it requires this device and your hardware key.
              </Text>
            )}

            {initiateAlert ? (
              <button
                type='button'
                className='vault-panel'
                data-testid='initiate-alert'
                onClick={() => openRecover('lost', 'home')}
              >
                <Text small bold>
                  Recovery in process
                </Text>
                <Text color='neutral-600' tiny wrap>
                  {initiateAlert} Waiting is measured in blocks, and cancellation requires the vault services unless
                  this vault supports hardware-only cancellation.
                </Text>
              </button>
            ) : null}

            <ErrorMessage error={Boolean(error || balanceError)} text={error || balanceError} />
            {balanceError ? (
              <Button secondary label='Retry' loading={refreshingBalance} onClick={() => void refreshBalance()} />
            ) : null}

            <FlexRow padding='0 0 0.5rem 0'>
              <Button
                main
                icon={<SendIcon />}
                label={spending ? 'Send' : 'Move to Spending'}
                disabled={spending ? !canSend : savingsSats <= 330}
                onClick={() => {
                  if (!spending && boardingAddress) setSpendDraft({ address: boardingAddress })
                  navigate('send')
                }}
              />
              <Button
                main
                icon={<ReceiveIcon />}
                label={spending ? 'Receive' : 'Add to Savings'}
                onClick={() => navigate('receive')}
              />
            </FlexRow>
            <VaultHistory />
            {status?.enrolled && (!spendingArkAddress || !boardingAddress) ? (
              <Text color='neutral-600' tiny wrap>
                Receive isn’t ready yet. Try again after setup finishes.
              </Text>
            ) : null}
          </div>
        </Padded>
      </Content>
    </>
  )
}
