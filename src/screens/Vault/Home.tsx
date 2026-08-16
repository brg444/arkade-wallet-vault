import { useContext, useEffect } from 'react'
import Button from '../../components/Button'
import Content from '../../components/Content'
import ErrorMessage from '../../components/Error'
import FlexCol from '../../components/FlexCol'
import FlexRow from '../../components/FlexRow'
import Padded from '../../components/Padded'
import Text from '../../components/Text'
import FingerprintIcon from '../../icons/Fingerprint'
import ReceiveIcon from '../../icons/Receive'
import SafeIcon from '../../icons/Safe'
import SendIcon from '../../icons/Send'
import ShieldCheckOutlineIcon from '../../icons/ShieldCheckOutline'
import { prettyAmount } from '../../lib/format'
import { VaultContext } from '../../providers/vault'
import { KeyCard, Meter, Panel, Pill } from './ui'

export default function VaultHome() {
  const {
    addTestCoins,
    amountSats,
    busy,
    canSend,
    dailyLimit,
    dailyRemaining,
    error,
    navigate,
    faucetUrl,
    liveNetwork,
    networkLabel,
    operationalAddress,
    preview,
    refreshBalance,
    reset,
    setup,
    status,
  } = useContext(VaultContext)

  useEffect(() => {
    if (!liveNetwork) return
    void refreshBalance()
    const onFocus = () => {
      void refreshBalance()
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [liveNetwork, refreshBalance])

  const used = Math.max(0, dailyLimit - dailyRemaining)
  const ratio = dailyLimit > 0 ? Math.min(1, used / dailyLimit) : 0
  const phoneReady = Boolean(status?.enrolled)
  const hardwareStatus = setup.hardwareIsDemo ? 'Demo' : setup.hardwarePub ? 'Ready' : 'Needed'
  const recoveryStatus = setup.recoveryIsDemo ? 'Demo' : setup.recoveryPub ? 'Ready' : 'Needed'

  return (
    <>
      <div className='header'>
        <FlexRow between>
          <div style={{ minWidth: '4rem' }} />
          <p className='title'>Spending</p>
          <div
            style={{ minWidth: '4rem', paddingRight: '1rem', textAlign: 'right', cursor: 'pointer' }}
            onClick={reset}
            data-testid='vault-reset'
          >
            <Text color='neutral-600' tiny>
              Reset
            </Text>
          </div>
        </FlexRow>
      </div>
      <Content noRefresh>
        <Padded>
          <FlexCol>
            <FlexCol gap='0.25rem' margin='1.25rem 0 0.25rem 0'>
              <Text bigger heading medium testId='vault-balance'>
                {prettyAmount(amountSats)}
              </Text>
              <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', alignItems: 'center' }}>
                <Pill>
                  {liveNetwork ? 'Mutinynet · live coins' : preview ? 'Demo balance · not on a chain' : networkLabel}
                </Pill>
                <Pill>{phoneReady ? 'Daily path ready' : 'Preview'}</Pill>
              </div>
            </FlexCol>
            <FlexCol gap='0.35rem'>
              <Text color='neutral-600' tiny>
                Phone may spend {prettyAmount(dailyRemaining)} of {prettyAmount(dailyLimit)} today
              </Text>
              <Meter ratio={ratio} label='Daily spending remaining' />
            </FlexCol>
            <FlexRow padding='0.35rem 0 0 0'>
              <Button main icon={<SendIcon />} label='Send' disabled={!canSend} onClick={() => navigate('send')} />
              <Button main icon={<ReceiveIcon />} label='Receive' onClick={() => navigate('receive')} />
            </FlexRow>
            <ErrorMessage error={Boolean(error)} text={error} />
            <Panel onClick={() => navigate('savings')}>
              <Text color='neutral-600' tiny>
                Savings
              </Text>
              <Text small>Locked — hardware + recovery only</Text>
            </Panel>
            <div>
              <Text color='neutral-600' tiny>
                Keys
              </Text>
            </div>
            <KeyCard
              icon={<FingerprintIcon />}
              title='This phone'
              role='Daily spending'
              status={phoneReady ? 'Healthy' : 'Preview'}
              onClick={() => navigate('keys')}
            />
            <KeyCard
              icon={<ShieldCheckOutlineIcon />}
              title='Hardware'
              role='Sweep and change'
              status={hardwareStatus}
              fingerprint={setup.hardwarePub}
              onClick={() => navigate('keys')}
            />
            <KeyCard
              icon={<SafeIcon />}
              title='Recovery'
              role='If this phone is gone'
              status={recoveryStatus}
              fingerprint={setup.recoveryPub}
              onClick={() => navigate('keys')}
            />
          </FlexCol>
        </Padded>
      </Content>
      {liveNetwork ? (
        <div style={{ padding: '0 1rem 1.25rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <Button
            onClick={() =>
              window.open(operationalAddress ? `${faucetUrl}?address=${operationalAddress}` : faucetUrl, '_blank')
            }
            label='Open Mutinynet faucet'
            secondary
          />
          <Button
            onClick={() => void refreshBalance()}
            disabled={busy}
            label={busy ? 'Checking…' : 'Refresh balance'}
            clear
          />
        </div>
      ) : preview || amountSats === 0 ? (
        <div style={{ padding: '0 1rem 1.25rem' }}>
          <Button onClick={addTestCoins} disabled={busy} label={busy ? 'Adding…' : 'Add demo coins'} secondary />
        </div>
      ) : null}
    </>
  )
}
