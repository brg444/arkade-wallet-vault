import { useContext, useState } from 'react'
import Button from '../../../components/Button'
import Input from '../../../components/Input'
import Text from '../../../components/Text'
import { pasteFromClipboard } from '../../../lib/clipboard'
import SafeIcon from '../../../icons/Safe'
import { VaultContext } from '../../../vault/context'
import { KeyCard } from '../ui'
import { ChoiceCard, OnboardLayout } from './Layout'

export default function VaultRecovery() {
  const { applyRecovery, error, navigate, setProtectionTier, setup, skipRecovery } = useContext(VaultContext)
  const [value, setValue] = useState(setup.recoveryPub)
  const hasKey = value.trim().length > 0
  const advanced = setup.protectionTier === 'advanced'

  return (
    <OnboardLayout
      title='Protection'
      step={3}
      total={6}
      error={error}
      onBack={() => navigate('hardware')}
      actions={
        advanced ? (
          <Button onClick={() => applyRecovery(value)} disabled={!hasKey} label='Use Advanced' />
        ) : (
          <Button onClick={skipRecovery} label='Use Standard' />
        )
      }
    >
      <p className='vault-onboard-eyebrow'>Choose your setup</p>
      <h2 className='vault-onboard-title'>How should recovery work?</h2>
      <Text wrap>
        Both options use this device, a hardware key, and the Vault service. Advanced adds a separate recovery key.
      </Text>
      <div className='vault-policy-presets' aria-label='Protection tier'>
        <ChoiceCard
          title='Standard'
          detail='This device and hardware key. No separate recovery key.'
          selected={!advanced}
          onClick={() => setProtectionTier('standard')}
          testId='protection-standard'
        />
        <ChoiceCard
          title='Advanced'
          detail='Add a separate recovery key for the existing delayed recovery paths.'
          selected={advanced}
          onClick={() => setProtectionTier('advanced')}
          testId='protection-advanced'
        />
      </div>
      {advanced ? (
        <>
          <KeyCard icon={<SafeIcon />} title='Recovery key' role='Starts a wait you can cancel. Not for daily spend.' />
          <Text color='neutral-600' tiny wrap>
            The Recovery Kit is a separate file you’ll save after setup. It is not a seed and does not contain this key.
          </Text>
          <Input
            label='Recovery public key'
            placeholder='02… or 03…'
            value={value}
            onChange={setValue}
            testId='recovery-pub'
          />
          <button
            type='button'
            className='vault-inline-paste'
            onClick={() => void pasteFromClipboard().then((next) => setValue(next || value))}
          >
            Paste
          </button>
        </>
      ) : (
        <div className='vault-callout' role='status'>
          <Text small bold>
            No recovery key
          </Text>
          <Text color='neutral-600' tiny wrap>
            Standard cannot use the recovery-key paths. Losing both this device and the hardware key can leave funds
            without a cooperative recovery path.
          </Text>
        </div>
      )}
    </OnboardLayout>
  )
}
