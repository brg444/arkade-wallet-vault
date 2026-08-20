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
import { Panel } from './ui'

type ReceiveDest = 'spend' | 'savings'

export default function VaultReceive() {
  const { account, faucetUrl, liveNetwork, navigate, operationalAddress, savingsAddress, spendingArkAddress } =
    useContext(VaultContext)
  const { toast } = useToast()
  const [copied, setCopied] = useState(false)
  const [dest, setDest] = useState<ReceiveDest>(account === 'savings' ? 'savings' : 'spend')

  const address = dest === 'savings' ? savingsAddress : spendingArkAddress || operationalAddress
  const receivingVtxo = dest === 'spend' && Boolean(spendingArkAddress)

  const handleCopy = async () => {
    if (!address) return
    await copyToClipboard(address)
    setCopied(true)
    toast(dest === 'savings' ? 'Savings address copied' : 'Address copied')
  }

  return (
    <>
      <Header text='Receive' back={() => navigate('home')} />
      <Content noRefresh>
        <Padded>
          <FlexCol>
            <Text color='neutral-600' tiny wrap>
              {liveNetwork ? 'Testnet. Don’t send real bitcoin.' : 'Don’t send real bitcoin.'}
            </Text>
            <div className='vault-receive-dests'>
              <Panel
                selected={dest === 'spend'}
                onClick={() => {
                  setDest('spend')
                  setCopied(false)
                }}
                testId='receive-spend'
              >
                <Text small bold>
                  Spending
                </Text>
                <Text color='neutral-600' tiny wrap>
                  {spendingArkAddress ? 'Receive VTXOs for regular sends' : 'This device, up to today’s limit'}
                </Text>
              </Panel>
              <Panel
                selected={dest === 'savings'}
                onClick={() => {
                  setDest('savings')
                  setCopied(false)
                }}
                testId='receive-savings'
              >
                <Text small bold>
                  Savings
                </Text>
                <Text color='neutral-600' tiny wrap>
                  This device and hardware
                </Text>
              </Panel>
            </div>
            {address ? (
              <div className='vault-receive-qr'>
                <QrCode value={address} />
              </div>
            ) : (
              <Text>No address yet.</Text>
            )}
            <p className='vault-receive-addr' data-testid='receive-address'>
              {address || '—'}
            </p>
            {dest === 'savings' ? (
              <Text color='neutral-600' tiny wrap>
                This device can’t spend this alone. Hardware signs too.
              </Text>
            ) : (
              <Text color='neutral-600' tiny wrap>
                {receivingVtxo
                  ? 'Send to this Arkade address from another Arkade wallet.'
                  : 'This device can spend this, up to today’s limit.'}
              </Text>
            )}
          </FlexCol>
        </Padded>
      </Content>
      <ButtonsOnBottom>
        <Button onClick={handleCopy} disabled={!address} label={copied ? 'Copied' : 'Copy address'} />
        {liveNetwork && address && !receivingVtxo ? (
          <Button
            onClick={() => window.open(`${faucetUrl}?address=${address}`, '_blank')}
            label='Get test coins'
            secondary
          />
        ) : null}
      </ButtonsOnBottom>
    </>
  )
}
