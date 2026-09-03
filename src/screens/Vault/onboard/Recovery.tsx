import { useContext, useState } from 'react'
import { Check, Circle, Clipboard, KeyRound, ShieldCheck } from 'lucide-react'
import ErrorMessage from '../../../components/Error'
import { pasteFromClipboard } from '../../../lib/clipboard'
import { VaultContext } from '../../../vault/context'
import QgScreen, { QgPrimary } from '../qg/QgScreen'

export default function VaultRecovery() {
  const { applyRecovery, error, navigate, setProtectionTier, setup, skipRecovery } = useContext(VaultContext)
  const [value, setValue] = useState(setup.recoveryPub)
  const hasKey = value.trim().length > 0
  const advanced = setup.protectionTier === 'advanced'

  return (
    <QgScreen
      title='Protection'
      stepLabel='3 of 6'
      back={() => navigate('hardware')}
      footer={
        <>
          <ErrorMessage error={Boolean(error)} text={error || ''} />
          {advanced ? (
            <QgPrimary onClick={() => applyRecovery(value)} disabled={!hasKey} label='Continue with Advanced' />
          ) : (
            <QgPrimary onClick={skipRecovery} label='Continue with Standard' />
          )}
        </>
      }
    >
      <p className='qg-eyebrow'>Choose your setup</p>
      <h1>How should recovery work?</h1>
      <p className='qg-copy'>
        Both options use this device, a hardware key, and the Vault service. Advanced adds a separate recovery key.
      </p>
      <div className='qg-choice-list' role='radiogroup' aria-label='Protection tier'>
        <button
          type='button'
          role='radio'
          aria-checked={!advanced}
          data-testid='protection-standard'
          onClick={() => setProtectionTier('standard')}
        >
          <span className='qg-choice-icon'>
            <ShieldCheck />
          </span>
          <span>
            <strong>Standard</strong>
            <small>No separate recovery key</small>
            <em>Recommended for most people</em>
          </span>
          {!advanced ? <Check /> : <Circle />}
        </button>
        <button
          type='button'
          role='radio'
          aria-checked={advanced}
          data-testid='protection-advanced'
          onClick={() => setProtectionTier('advanced')}
        >
          <span className='qg-choice-icon'>
            <KeyRound />
          </span>
          <span>
            <strong>Advanced</strong>
            <small>Add a separate recovery key</small>
            <em>More control, more responsibility</em>
          </span>
          {advanced ? <Check /> : <Circle />}
        </button>
      </div>
      {advanced ? (
        <div className='qg-recovery-key'>
          <label className='qg-field'>
            <span>Recovery public key</span>
            <input
              value={value}
              data-testid='recovery-pub'
              aria-label='Recovery public key'
              placeholder='02… or 03…'
              onChange={(event) => setValue(event.target.value)}
            />
            <small>Must be different from the hardware key</small>
          </label>
          <button
            type='button'
            className='qg-paste'
            onClick={() => void pasteFromClipboard().then((next) => setValue(next || value))}
          >
            <Clipboard />
            Paste public key
          </button>
        </div>
      ) : null}
    </QgScreen>
  )
}
