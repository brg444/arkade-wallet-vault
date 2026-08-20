import { useContext, useMemo, useState } from 'react'
import Button from '../../components/Button'
import ButtonsOnBottom from '../../components/ButtonsOnBottom'
import Content from '../../components/Content'
import FlexCol from '../../components/FlexCol'
import Header from '../../components/Header'
import Padded from '../../components/Padded'
import QrCode from '../../components/QrCode'
import Text from '../../components/Text'
import { useToast } from '../../components/Toast'
import { encodeBip21 } from '../../lib/bip21'
import { copyToClipboard } from '../../lib/clipboard'
import { truncateAddress } from '../../lib/vault/policy'
import { VaultContext } from '../../providers/vault'
import { HubGroup, HubRow } from './ui'

export default function VaultReceive() {
  const { account, boardingAddress, faucetUrl, liveNetwork, navigate, savingsAddress, spendingArkAddress } =
    useContext(VaultContext)
  const { toast } = useToast()
  const [copied, setCopied] = useState('')
  const spending = account === 'spend'
  const unified = useMemo(
    () => (boardingAddress && spendingArkAddress ? encodeBip21(boardingAddress, spendingArkAddress, '', 0) : ''),
    [boardingAddress, spendingArkAddress],
  )
  const request = spending ? unified : savingsAddress
  const faucetAddress = spending ? boardingAddress : savingsAddress

  const copy = async (value: string, label: string) => {
    if (!value) return
    await copyToClipboard(value)
    setCopied(value)
    toast(`${label} copied`)
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
            <Text small bold>
              {spending ? 'Arkade or Bitcoin' : 'Savings'}
            </Text>
            <Text color='neutral-600' tiny wrap>
              {spending
                ? 'One request accepts an Arkade payment or a confirmed Bitcoin deposit. Bitcoin is boarded into VTXOs automatically.'
                : 'Bitcoin sent here stays in Savings and requires this device plus hardware to spend.'}
            </Text>
            {request ? (
              <div className='vault-receive-qr'>
                <QrCode value={request} />
              </div>
            ) : (
              <Text>No address yet.</Text>
            )}
            <p className='vault-receive-addr' data-testid='receive-address'>
              {request || '—'}
            </p>
            {spending ? (
              <HubGroup label='Payment addresses'>
                <HubRow
                  title='Arkade address'
                  detail={truncateAddress(spendingArkAddress, 10)}
                  status={copied === spendingArkAddress ? 'Copied' : 'Copy'}
                  onClick={() => void copy(spendingArkAddress, 'Arkade address')}
                  testId='receive-arkade-address'
                />
                <HubRow
                  title='Bitcoin address'
                  detail={truncateAddress(boardingAddress, 10)}
                  status={copied === boardingAddress ? 'Copied' : 'Copy'}
                  onClick={() => void copy(boardingAddress, 'Bitcoin address')}
                  testId='receive-bitcoin-address'
                />
              </HubGroup>
            ) : null}
          </FlexCol>
        </Padded>
      </Content>
      <ButtonsOnBottom>
        <Button
          onClick={() => void copy(request, spending ? 'Payment request' : 'Savings address')}
          disabled={!request}
          label={copied === request ? 'Copied' : spending ? 'Copy request' : 'Copy address'}
        />
        {liveNetwork && faucetAddress ? (
          <Button
            onClick={() => window.open(`${faucetUrl}?address=${faucetAddress}`, '_blank')}
            label='Get test coins'
            secondary
          />
        ) : null}
      </ButtonsOnBottom>
    </>
  )
}
