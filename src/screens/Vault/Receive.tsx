import { useContext, useMemo, useState } from 'react'
import Button from '../../components/Button'
import ButtonsOnBottom from '../../components/ButtonsOnBottom'
import Content from './Content'
import FlexCol from '../../components/FlexCol'
import Header from './Header'
import Padded from '../../components/Padded'
import QrCode from '../../components/QrCode'
import Text from '../../components/Text'
import { useToast } from '../../components/Toast'
import { copyToClipboard } from '../../lib/clipboard'
import { encodeVaultBip21 } from '../../lib/vault/bip21'
import { truncateAddress } from '../../lib/vault/policy'
import { VaultContext } from '../../vault/context'
import { HubGroup, HubRow } from './ui'

export default function VaultReceive() {
  const { account, boardingAddress, liveNetwork, navigate, savingsAddress, spendingArkAddress } =
    useContext(VaultContext)
  const { toast } = useToast()
  const [copied, setCopied] = useState('')
  const spending = account === 'spend'
  const unified = useMemo(
    () =>
      boardingAddress && spendingArkAddress
        ? encodeVaultBip21({ bitcoinAddress: boardingAddress, arkadeAddress: spendingArkAddress })
        : '',
    [boardingAddress, spendingArkAddress],
  )
  const request = spending ? unified : savingsAddress

  const copy = async (value: string, label: string) => {
    if (!value) return
    await copyToClipboard(value)
    setCopied(value)
    toast(`${label} copied`)
  }

  return (
    <>
      <Header text={spending ? 'Receive to Spending' : 'Add to Savings'} back={() => navigate('home')} />
      <Content noRefresh>
        <Padded>
          <FlexCol>
            <Text color='neutral-600' tiny wrap>
              {liveNetwork ? 'Testnet. Don’t send real bitcoin.' : 'Don’t send real bitcoin.'}
            </Text>
            <Text small bold>
              {spending ? 'One payment request' : 'Savings address'}
            </Text>
            <Text color='neutral-600' tiny wrap>
              {spending
                ? 'Use this for Arkade or Bitcoin. Confirmed Bitcoin deposits move into Spending automatically.'
                : 'Bitcoin sent here stays in Savings. Sending it later requires this device and hardware.'}
            </Text>
            {request ? (
              <div className='vault-receive-qr'>
                <QrCode value={request} />
              </div>
            ) : (
              <Text>No address yet.</Text>
            )}
            {!spending ? (
              <p className='vault-receive-addr' data-testid='receive-address'>
                {request || '—'}
              </p>
            ) : null}
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
          label={copied === request ? 'Copied' : spending ? 'Copy payment request' : 'Copy Savings address'}
        />
      </ButtonsOnBottom>
    </>
  )
}
