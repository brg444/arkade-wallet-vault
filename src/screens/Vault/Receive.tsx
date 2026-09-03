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
  const { account, boardingAddress, navigate, savingsAddress, spendingArkAddress } = useContext(VaultContext)
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
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function'

  const copy = async (value: string, label: string) => {
    if (!value) return
    await copyToClipboard(value)
    setCopied(value)
    toast(`${label} copied`)
  }

  const share = async () => {
    if (!request || !canShare) return
    try {
      await navigator.share({
        title: spending ? 'Arkade Vault payment request' : 'Arkade Vault Savings address',
        text: request,
      })
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      toast('Sharing is unavailable. Copy the request instead.')
    }
  }

  return (
    <>
      <Header text={spending ? 'Receive to Spending' : 'Add to Savings'} back={() => navigate('home')} />
      <Content noRefresh className='vault-receive-content'>
        <Padded>
          <FlexCol>
            {request ? (
              <QrCode large value={request} />
            ) : (
              <Text>
                {spending
                  ? 'Spending receive is unavailable. Return to the wallet and try again.'
                  : 'Savings is not restored on this device. Sign in again to restore it.'}
              </Text>
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
        {canShare ? (
          <Button
            className='vault-commit-action'
            onClick={() => void share()}
            disabled={!request}
            label={spending ? 'Share payment request' : 'Share Savings address'}
          />
        ) : null}
        <Button
          secondary={canShare}
          className={canShare ? undefined : 'vault-commit-action'}
          onClick={() => void copy(request, spending ? 'Payment request' : 'Savings address')}
          disabled={!request}
          label={copied === request ? 'Copied' : spending ? 'Copy payment request' : 'Copy Savings address'}
        />
      </ButtonsOnBottom>
    </>
  )
}
