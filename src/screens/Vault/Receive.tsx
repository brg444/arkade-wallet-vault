import { useContext, useState } from 'react'
import Button from '../../components/Button'
import ButtonsOnBottom from '../../components/ButtonsOnBottom'
import Content from '../../components/Content'
import FlexCol from '../../components/FlexCol'
import Header from '../../components/Header'
import Padded from '../../components/Padded'
import QrCode from '../../components/QrCode'
import Text from '../../components/Text'
import { copyToClipboard } from '../../lib/clipboard'
import { VaultContext } from '../../providers/vault'
import { useToast } from '../../components/Toast'

export default function VaultReceive() {
  const { descriptor, navigate, status } = useContext(VaultContext)
  const { toast } = useToast()
  const [copied, setCopied] = useState(false)
  const address = descriptor?.operational.address || status?.operationalAddress || ''

  const handleCopy = async () => {
    if (!address) return
    await copyToClipboard(address)
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
              Fund only the Operational address. Savings is a separate user-only output and is not this QR.
            </Text>
            {address ? <QrCode value={address} /> : <Text>No Operational address imported.</Text>}
            <Text centered small wrap>
              {address || '—'}
            </Text>
          </FlexCol>
        </Padded>
      </Content>
      <ButtonsOnBottom>
        <Button onClick={handleCopy} disabled={!address} label={copied ? 'Copied' : 'Copy address'} />
      </ButtonsOnBottom>
    </>
  )
}
