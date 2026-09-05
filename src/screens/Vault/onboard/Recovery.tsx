import { useContext, useState } from 'react'
import { Check, Circle, Clipboard, KeyRound, ShieldCheck } from 'lucide-react'
import ErrorMessage from '../../../components/Error'
import { pasteFromClipboard } from '../../../lib/clipboard'
import { VaultContext } from '../../../vault/context'
import RecoveryExplanation from '../qg/RecoveryExplanation'
import QgScreen, { QgPrimary } from '../qg/QgScreen'

export default function VaultRecovery() {
  const { applyRecovery, error, navigate, setProtectionTier, setup, skipRecovery, networkLabel } =
    useContext(VaultContext)
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
        Both options use your passkey and hardware wallet for normal Savings transfers. Advanced adds a separate key for
        delayed Savings recovery if you lose access to both.
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
            <small>Recover Savings with one remaining key</small>
            <em>Requires passkey access or your hardware key</em>
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
            <small>Add a separately stored recovery key</small>
            <em>Use this key if both normal keys are lost</em>
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
            <small>Use an independent key, stored separately from your passkey and hardware backup.</small>
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
      <section className='qg-note'>
        <ShieldCheck />
        <div>
          <strong>Recovery services must be available to start</strong>
          <p>
            The waiting period gives eligible remaining keys a chance to cancel. Your protection choice is fixed after
            setup.
          </p>
        </div>
      </section>
      <RecoveryExplanation advanced={advanced} mainnet={networkLabel === 'Bitcoin'} />
    </QgScreen>
  )
}
