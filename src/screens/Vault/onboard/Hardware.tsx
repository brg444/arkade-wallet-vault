import { useContext, useEffect, useState } from 'react'
import { Clipboard, TriangleAlert } from 'lucide-react'
import ErrorMessage from '../../../components/Error'
import { pasteFromClipboard } from '../../../lib/clipboard'
import { VaultContext } from '../../../vault/context'
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
          ? 'This vault already has hardware. Confirm this is that key.'
          : 'An independent hardware approval prevents a compromised phone from moving Savings by itself. This key can also cancel a recovery you did not start.'}
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
