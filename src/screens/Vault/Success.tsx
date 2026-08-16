import { useContext } from 'react'
import Button from '../../components/Button'
import ButtonsOnBottom from '../../components/ButtonsOnBottom'
import Content from '../../components/Content'
import FlexCol from '../../components/FlexCol'
import Header from '../../components/Header'
import Padded from '../../components/Padded'
import Success from '../../components/Success'
import Text from '../../components/Text'
import { prettyAmount } from '../../lib/format'
import { truncateAddress } from '../../lib/vault/policy'
import { VaultContext } from '../../providers/vault'
import { Detail, Pill, SignerRow } from './ui'

export default function VaultSuccess() {
  const { lastSend, lastTxid, liveNetwork, navigate, preview } = useContext(VaultContext)
  const amount = lastSend ? prettyAmount(lastSend.amount) : 'Payment'
  const explorer = lastTxid ? `https://mempool.mutinynet.arkade.sh/tx/${lastTxid}` : ''

  return (
    <>
      <Header text='Sent' />
      <Content noRefresh>
        <Padded>
          <FlexCol>
            <Success
              headline={amount}
              text={
                lastTxid
                  ? `Broadcast on Mutinynet · ${lastTxid.slice(0, 12)}…`
                  : preview
                    ? 'Preview only — nothing left this device.'
                    : 'Your payment was submitted.'
              }
            />
            <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
              <Pill>Daily phone path</Pill>
              {lastTxid ? <Pill>On chain</Pill> : <Pill>Preview</Pill>}
            </div>
            {lastSend ? (
              <>
                <Detail label='To' value={truncateAddress(lastSend.address, 8)} mono />
                <Detail label='Network fee' value={prettyAmount(lastSend.fee)} />
              </>
            ) : null}
            <SignerRow title='You · this phone' detail='Approved' state='auto' />
            <SignerRow
              title='Vault service'
              detail={lastTxid ? 'Cosigned and broadcast' : 'Preview — not broadcast'}
              state={lastTxid || !preview ? 'auto' : 'unused'}
            />
            {liveNetwork && lastTxid ? (
              <Text color='neutral-600' tiny wrap>
                Mutinynet explorer: {lastTxid}
              </Text>
            ) : null}
          </FlexCol>
        </Padded>
      </Content>
      <ButtonsOnBottom>
        {liveNetwork && explorer ? (
          <Button onClick={() => window.open(explorer, '_blank')} label='View on Mutinynet' secondary />
        ) : null}
        <Button onClick={() => navigate('home')} label='Done' />
      </ButtonsOnBottom>
    </>
  )
}
