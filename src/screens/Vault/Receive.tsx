import { useContext, useState } from 'react'
import Button from '../../components/Button'
import ButtonsOnBottom from '../../components/ButtonsOnBottom'
import Content from '../../components/Content'
import FlexCol from '../../components/FlexCol'
import Header from '../../components/Header'
import Padded from '../../components/Padded'
import QrCode from '../../components/QrCode'
import Text from '../../components/Text'
import { useToast } from '../../components/Toast'
import { copyToClipboard } from '../../lib/clipboard'
import { VaultContext } from '../../providers/vault'

export default function VaultReceive() {
  const { navigate, operationalAddress } = useContext(VaultContext)
  const { toast } = useToast()
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    if (!operationalAddress) return
    await copyToClipboard(operationalAddress)
    setCopied(true)
    toast('Address copied')
  }

  return (
    <>
      <Header text='Receive' back={() => navigate('home')} />
      <Content noRefresh>
        <Padded>
          <FlexCol>
            <Text small wrap>
              Send test bitcoin to this spending address. Do not send real bitcoin.
            </Text>
            {operationalAddress ? <QrCode value={operationalAddress} /> : <Text>No address yet.</Text>}
            <Text centered small wrap testId='receive-address'>
              {operationalAddress || '—'}
            </Text>
          </FlexCol>
        </Padded>
      </Content>
      <ButtonsOnBottom>
        <Button onClick={handleCopy} disabled={!operationalAddress} label={copied ? 'Copied' : 'Copy address'} />
      </ButtonsOnBottom>
    </>
  )
}
