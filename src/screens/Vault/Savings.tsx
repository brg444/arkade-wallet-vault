import { useContext, useState } from 'react'
import Button from '../../components/Button'
import ButtonsOnBottom from '../../components/ButtonsOnBottom'
import Content from '../../components/Content'
import FlexCol from '../../components/FlexCol'
import Header from '../../components/Header'
import Padded from '../../components/Padded'
import Text from '../../components/Text'
import { useToast } from '../../components/Toast'
import { copyToClipboard } from '../../lib/clipboard'
import { prettyAmount } from '../../lib/format'
import { VaultContext } from '../../providers/vault'
import VaultRefresher from './Refresher'

export default function VaultSavings() {
  const { navigate, savingsAddress, savingsSats } = useContext(VaultContext)
  const { toast } = useToast()
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    if (!savingsAddress) return
    await copyToClipboard(savingsAddress)
    setCopied(true)
    toast('Savings address copied')
  }

  return (
    <>
      <Header text='Savings' back={() => navigate('home')} />
      <Content noRefresh>
        <VaultRefresher />
        <Padded>
          <FlexCol>
            <div className='vault-hero'>
              <p className='vault-kicker'>Balance</p>
              <p className='vault-money'>{prettyAmount(savingsSats)}</p>
            </div>
            <Text color='neutral-600' tiny wrap>
              The passkey cannot spend this. Hardware plus recovery, or recovery after the long delay.
            </Text>
            <Text small wrap testId='savings-address'>
              {savingsAddress || 'No savings address yet.'}
            </Text>
          </FlexCol>
        </Padded>
      </Content>
      <ButtonsOnBottom>
        <Button onClick={handleCopy} disabled={!savingsAddress} label={copied ? 'Copied' : 'Copy address'} />
        <Button onClick={() => navigate('receive')} label='Receive to savings' secondary />
      </ButtonsOnBottom>
    </>
  )
}
