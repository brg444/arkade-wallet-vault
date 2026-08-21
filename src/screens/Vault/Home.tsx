import { useContext, useEffect, useState } from 'react'
import Button from '../../components/Button'
import Content from '../../components/Content'
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
import { VaultContext, type VaultAccount } from '../../providers/vault'
import VaultHistory from './History'
import { Meter } from './ui'

function fundableAddress(value: string): string {
  if (!value || value.startsWith('bcrt1')) return ''
  return value
}

export default function VaultHome() {
  const {
    account,
    addTestCoins,
    amountSats,
    busy,
    canSend,
    dailyLimit,
    dailyRemaining,
    error,
    navigate,
    openSendScan,
    openRecover,
    liveNetwork,
    initiateAlert,
    operationalAddress,
    spendingArkAddress,
    preview,
    refreshBalance,
    savingsAddress,
    savingsSats,
    setAccount,
    status,
  } = useContext(VaultContext)
  const { toast } = useToast()
  const [picker, setPicker] = useState(false)

  useEffect(() => {
    void reloadIfNewerWallet()
    if (liveNetwork) void refreshBalance()
    const onFocus = () => {
      void reloadIfNewerWallet()
      if (liveNetwork) void refreshBalance()
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [liveNetwork, refreshBalance])

  const spending = account === 'spend'
  const sats = spending ? amountSats : savingsSats
  const address = spending ? spendingArkAddress || fundableAddress(operationalAddress) : fundableAddress(savingsAddress)
  const used = Math.max(0, dailyLimit - dailyRemaining)
  const ratio = dailyLimit > 0 ? Math.min(1, used / dailyLimit) : 0
  const satsUnit = sats === 1 ? 'SAT' : 'SATS'

  const choose = (next: VaultAccount) => {
    setAccount(next)
    setPicker(false)
  }

  return (
    <>
      <Content noRefresh>
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
                  <p className='vault-account-addr is-empty'>
                    {liveNetwork ? 'Testnet' : preview ? 'Preview · not funded yet' : 'No address yet'}
                  </p>
                )}
              </div>
              <div className='vault-account-actions'>
                <button
                  type='button'
                  className='vault-account-qr'
                  aria-label='Scan'
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
                  aria-label='Receive'
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
                      {prettyNumber(amountSats)} {amountSats === 1 ? 'SAT' : 'SATS'}
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
                      {prettyNumber(savingsSats)} {savingsSats === 1 ? 'SAT' : 'SATS'}
                    </span>
                  </button>
                </div>
              </>
            ) : null}

            <p className='vault-balance-figure' data-testid='vault-balance'>
              {prettyNumber(sats)}
              <span className='vault-balance-unit'>{satsUnit}</span>
            </p>

            {spending ? (
              <FlexCol gap='0.35rem'>
                <Text color='neutral-600' tiny>
                  {prettyNumber(dailyRemaining, 0)} / {prettyNumber(dailyLimit, 0)} remaining in the rolling 24h limit
                </Text>
                <Meter ratio={ratio} label='Daily limit used' />
              </FlexCol>
            ) : (
              <Text color='neutral-600' tiny wrap>
                This device can’t send this alone. Hardware signs too.
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
                  {initiateAlert} Waiting is in blocks, not a calendar day. Cancel needs the vault services unless this
                  vault can cancel with hardware alone.
                </Text>
              </button>
            ) : null}
            <ErrorMessage error={Boolean(error)} text={error} />
            <FlexRow padding='0 0 0.5rem 0'>
              <Button
                main
                icon={<SendIcon />}
                label='Send'
                disabled={spending ? !canSend : savingsSats <= 330}
                onClick={() => navigate('send')}
              />
              <Button main icon={<ReceiveIcon />} label='Receive' onClick={() => navigate('receive')} />
            </FlexRow>
            <VaultHistory />
            {status?.enrolled && !operationalAddress ? (
              <Text color='neutral-600' tiny wrap>
                Receive isn’t ready yet. Try again after setup finishes.
              </Text>
            ) : null}
          </div>
        </Padded>
      </Content>
      {liveNetwork || !(preview || amountSats === 0) || !spending ? null : (
        <div style={{ padding: '0 1rem 1.25rem' }}>
          <Button onClick={addTestCoins} disabled={busy} label={busy ? 'Adding…' : 'Add demo coins'} secondary />
        </div>
      )}
    </>
  )
}
