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
import { Pill } from './ui'

export default function VaultReceive() {
  const { faucetUrl, liveNetwork, navigate, operationalAddress } = useContext(VaultContext)
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
            <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
              <Pill>Spending address</Pill>
              {liveNetwork ? <Pill>Mutinynet only</Pill> : <Pill>Test coins</Pill>}
            </div>
            <Text small wrap>
              {liveNetwork
                ? 'This is a Mutinynet address. Fund it from the faucet, then wait for a confirmation before sending. Do not send mainnet bitcoin.'
                : 'Send test bitcoin to this spending address. Do not send real bitcoin.'}
            </Text>
            {operationalAddress ? <QrCode value={operationalAddress} /> : <Text>No address yet.</Text>}
            <Text centered small wrap testId='receive-address'>
              {operationalAddress || '—'}
            </Text>
            <Text color='neutral-600' tiny wrap>
              Coins sent here can use the daily phone path. Savings is a different address.
            </Text>
          </FlexCol>
        </Padded>
      </Content>
      <ButtonsOnBottom>
        <Button onClick={handleCopy} disabled={!operationalAddress} label={copied ? 'Copied' : 'Copy address'} />
        {liveNetwork && operationalAddress ? (
          <Button
            onClick={() => window.open(`${faucetUrl}?address=${operationalAddress}`, '_blank')}
            label='Open Mutinynet faucet'
            secondary
          />
        ) : null}
      </ButtonsOnBottom>
    </>
  )
}
