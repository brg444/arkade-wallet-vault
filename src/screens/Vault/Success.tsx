import { useContext } from 'react'
import Button from '../../components/Button'
import ButtonsOnBottom from '../../components/ButtonsOnBottom'
import Content from '../../components/Content'
import Header from '../../components/Header'
import Success from '../../components/Success'
import { prettyAmount } from '../../lib/format'
import { VaultContext } from '../../providers/vault'

export default function VaultSuccess() {
  const { lastSend, lastTxid, liveNetwork, navigate, preview } = useContext(VaultContext)
  const amount = lastSend ? prettyAmount(lastSend.amount) : 'Payment'
  const explorer = lastTxid ? `https://mempool.mutinynet.arkade.sh/tx/${lastTxid}` : ''

  return (
    <>
      <Header text='Sent' />
      <Content noRefresh>
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
