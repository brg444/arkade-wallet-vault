import { useContext } from 'react'
import Button from '../../components/Button'
import ButtonsOnBottom from '../../components/ButtonsOnBottom'
import Content from '../../components/Content'
import Header from '../../components/Header'
import Success from '../../components/Success'
import { prettyAmount } from '../../lib/format'
import { VaultContext } from '../../providers/vault'

export default function VaultSuccess() {
  const { lastSend, navigate, preview } = useContext(VaultContext)
  const amount = lastSend ? prettyAmount(lastSend.amount) : 'Payment'

  return (
    <>
      <Header text='Sent' />
      <Content noRefresh>
        <Success
          headline={amount}
          text={preview ? 'Preview only — nothing left this device.' : 'Your payment was submitted.'}
        />
      </Content>
      <ButtonsOnBottom>
        <Button onClick={() => navigate('home')} label='Done' />
      </ButtonsOnBottom>
    </>
  )
}
