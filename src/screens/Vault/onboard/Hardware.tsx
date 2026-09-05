import { useContext, useEffect, useState } from 'react'
import { Clipboard, TriangleAlert } from 'lucide-react'
import ErrorMessage from '../../../components/Error'
import { pasteFromClipboard } from '../../../lib/clipboard'
import { VaultContext } from '../../../vault/context'
import '../qg/guidance.css'
import QgScreen, { QgPrimary } from '../qg/QgScreen'

export default function VaultHardware() {
  const { applyHardware, error, navigate, setup, status } = useContext(VaultContext)
  const required = status?.externalOwnerWalletPub || ''
  const [value, setValue] = useState(required || setup.hardwarePub)

  useEffect(() => {
    if (required) setValue(required)
  }, [required])

  const ready = Boolean(required || value.trim())

  return (
    <QgScreen
      title='Hardware key'
      stepLabel='2 of 6'
      back={() => navigate('design')}
      footer={
        <>
          <ErrorMessage error={Boolean(error)} text={error || ''} />
          <QgPrimary onClick={() => applyHardware(required || value)} disabled={!ready} label='Use this hardware key' />
        </>
      }
    >
      <p className='qg-eyebrow'>Protect Savings</p>
      <h1>Add your hardware key</h1>
      <p className='qg-copy'>
        {required
          ? 'This vault already has a hardware key. Check that you can still use the hardware wallet that holds it.'
          : 'Savings transfers need approval from your hardware wallet as well as your passkey. Keep the hardware key and its backup separate from your device.'}
      </p>
      <label className='qg-field'>
        <span>Hardware public key</span>
        <input
          value={value}
          readOnly={Boolean(required)}
          data-testid='hardware-pub'
          aria-label='Hardware public key'
          placeholder='02… or 03…'
          onChange={(event) => setValue(event.target.value)}
        />
        <small>Compressed public key beginning with 02 or 03</small>
      </label>
      {required ? null : (
        <button
          type='button'
          className='qg-paste'
          onClick={() => void pasteFromClipboard().then((next) => setValue(next || value))}
        >
          <Clipboard />
          Paste public key
        </button>
      )}
      <details className='qg-guidance'>
        <summary>Find and check your hardware public key</summary>
        <div className='qg-guidance-body'>
          <p>
            A public key identifies the key on your hardware wallet. Use its companion software to export the compressed
            public key, a 66-character value starting with 02 or 03.
          </p>
          <p>
            This is different from a Bitcoin address or an extended public key. Your hardware wallet also needs to sign
            Vaulted’s transaction files, called PSBTs.
          </p>
          <p>
            Before depositing, confirm that your hardware signing workflow supports Vaulted’s Savings transactions.
            Accepting a public key here checks its format, not whether your hardware can sign.
          </p>
        </div>
      </details>
      <section className='qg-note'>
        <TriangleAlert />
        <div>
          <strong>Public key only</strong>
          <p>Never enter a seed phrase or private key.</p>
        </div>
      </section>
    </QgScreen>
  )
}
