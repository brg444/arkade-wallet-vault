import { useContext, useMemo, useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import { useToast } from '../../components/Toast'
import QrCode from '../../components/QrCode'
import { copyToClipboard } from '../../lib/clipboard'
import { encodeVaultBip21 } from '../../lib/vault/bip21'
import { truncateAddress } from '../../lib/vault/policy'
import { VaultContext } from '../../vault/context'
import QgScreen, { QgPrimary } from './qg/QgScreen'

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

  const copy = async (value: string, label: string) => {
    if (!value) return
    await copyToClipboard(value)
    setCopied(value)
    toast(`${label} copied`)
  }

  return (
    <QgScreen
      title='Receive'
      back={() => navigate('home')}
      footer={
        <QgPrimary
          onClick={() => void copy(request, spending ? 'Payment request' : 'Savings address')}
          disabled={!request}
          label={copied === request ? 'Copied' : spending ? 'Copy payment request' : 'Copy Savings address'}
        />
      }
    >
      <div className='qg-receive'>
        <section className='qg-receive-copy'>
          {spending ? (
            <span className='qg-protected'>
              <ShieldCheck />
              Protected
            </span>
          ) : (
            <p className='qg-eyebrow'>Bitcoin address</p>
          )}
          <h3>{spending ? 'Receive to Spending' : 'Add to Savings'}</h3>
          <p>
            {spending
              ? 'Works with Arkade and Bitcoin wallets.'
              : 'Use this Bitcoin address. Moving it later needs this device and your hardware key.'}
          </p>
        </section>
        {request ? (
          <div className='qg-qr' aria-label='Payment request QR code'>
            <QrCode large value={request} />
          </div>
        ) : (
          <p className='qg-copy'>
            {spending
              ? 'Spending receive is unavailable. Return to the wallet and try again.'
              : 'Savings is not restored on this device. Sign in again to restore it.'}
          </p>
        )}
        {!spending ? (
          <p className='qg-receive-addr' data-testid='receive-address'>
            {request || '—'}
          </p>
        ) : null}
        {spending ? (
          <section className='qg-addresses' aria-label='Payment addresses'>
            <button
              type='button'
              data-testid='receive-arkade-address'
              onClick={() => void copy(spendingArkAddress, 'Arkade address')}
            >
              <span>
                <small>Arkade</small>
                <strong>{truncateAddress(spendingArkAddress, 10)}</strong>
              </span>
              <b>{copied === spendingArkAddress ? 'Copied' : 'Copy'}</b>
            </button>
            <button
              type='button'
              data-testid='receive-bitcoin-address'
              onClick={() => void copy(boardingAddress, 'Bitcoin address')}
            >
              <span>
                <small>Bitcoin</small>
                <strong>{truncateAddress(boardingAddress, 10)}</strong>
              </span>
              <b>{copied === boardingAddress ? 'Copied' : 'Copy'}</b>
            </button>
          </section>
        ) : null}
      </div>
    </QgScreen>
  )
}
