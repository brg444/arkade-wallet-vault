import { useContext } from 'react'
import Button from '../../components/Button'
import Content from '../../components/Content'
import ErrorMessage from '../../components/Error'
import FlexCol from '../../components/FlexCol'
import FlexRow from '../../components/FlexRow'
import Padded from '../../components/Padded'
import Text from '../../components/Text'
import ReceiveIcon from '../../icons/Receive'
import SendIcon from '../../icons/Send'
import { prettyAmount } from '../../lib/format'
import { VaultContext } from '../../providers/vault'

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
    networkLabel,
    preview,
    reset,
  } = useContext(VaultContext)

  const used = dailyLimit - dailyRemaining
  const ratio = dailyLimit > 0 ? Math.min(1, used / dailyLimit) : 0

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
            <FlexCol gap='0.25rem' margin='2rem 0 0.5rem 0'>
              <Text bigger heading medium testId='vault-balance'>
                {prettyAmount(amountSats)}
              </Text>
              <Text color='neutral-600' small>
                {networkLabel}
                {preview ? ' · Preview' : ''}
              </Text>
            </FlexCol>
            <FlexCol gap='0.35rem'>
              <Text color='neutral-600' tiny>
                {prettyAmount(dailyRemaining)} left of {prettyAmount(dailyLimit)} today
              </Text>
              <div
                aria-label='Daily spending remaining'
                style={{ width: '100%', height: 6, borderRadius: 99, background: 'var(--neutral-200, #2a2a2a)' }}
              >
                <div
                  style={{
                    width: `${Math.round(ratio * 100)}%`,
                    height: '100%',
                    borderRadius: 99,
                    background: 'var(--logo-color, #6ee7b7)',
                  }}
                />
              </div>
            </FlexCol>
            <FlexRow padding='0.5rem 0 0 0'>
              <Button main icon={<SendIcon />} label='Send' disabled={!canSend} onClick={() => navigate('send')} />
              <Button main icon={<ReceiveIcon />} label='Receive' onClick={() => navigate('receive')} />
            </FlexRow>
            <ErrorMessage error={Boolean(error)} text={error} />
            {amountSats === 0 ? (
              <Text color='neutral-600' small wrap>
                Receive test bitcoin, or add test coins if this vault is running locally.
              </Text>
            ) : null}
            <button
              type='button'
              onClick={() => navigate('savings')}
              style={{
                background: 'none',
                border: 'none',
                padding: 0,
                textAlign: 'left',
                cursor: 'pointer',
                width: '100%',
              }}
            >
              <FlexCol gap='0.15rem'>
                <Text color='neutral-600' tiny>
                  Savings
                </Text>
                <Text small>Locked — not spendable from this phone</Text>
              </FlexCol>
            </button>
          </FlexCol>
        </Padded>
      </Content>
      {preview || amountSats === 0 ? (
        <div style={{ padding: '0 1rem 1.25rem' }}>
          <Button onClick={addTestCoins} disabled={busy} label={busy ? 'Adding…' : 'Add test coins'} secondary />
        </div>
      ) : null}
    </>
  )
}
