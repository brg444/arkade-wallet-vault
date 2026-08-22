import { useContext, useEffect, useState } from 'react'
import Button from '../../../components/Button'
import Input from '../../../components/Input'
import Text from '../../../components/Text'
import { pasteFromClipboard } from '../../../lib/clipboard'
import ShieldCheckOutlineIcon from '../../../icons/ShieldCheckOutline'
import { VaultContext } from '../../../vault/context'
import { KeyCard } from '../ui'
import { OnboardLayout } from './Layout'

export default function VaultHardware() {
  const { applyHardware, error, navigate, setup, status } = useContext(VaultContext)
  const required = status?.externalOwnerWalletPub || ''
  const [value, setValue] = useState(required || setup.hardwarePub)

  useEffect(() => {
    if (required) setValue(required)
  }, [required])

  const ready = Boolean(required || value.trim())

  return (
    <OnboardLayout
      title='Add hardware'
      step={2}
      error={error}
      onBack={() => navigate('design')}
      actions={<Button onClick={() => applyHardware(required || value)} disabled={!ready} label='Continue' />}
    >
      <Text wrap>
        {required
          ? 'This vault already has hardware. Confirm this is that key.'
          : 'This key moves Savings with this device. It can also cancel a recovery you didn’t start.'}
      </Text>
      {required ? (
        <KeyCard
          icon={<ShieldCheckOutlineIcon />}
          title='Hardware'
          role='Already on this vault'
          fingerprint={required}
        />
      ) : (
        <>
          <Input
            label='Hardware public key'
            placeholder='02… or 03…'
            value={value}
            onChange={setValue}
            testId='hardware-pub'
          />
          <button
            type='button'
            className='vault-inline-paste'
            onClick={() => void pasteFromClipboard().then((next) => setValue(next || value))}
          >
            Paste
          </button>
          <Text color='neutral-600' tiny wrap>
            Starts with 02 or 03. Never paste a seed.
          </Text>
        </>
      )}
    </OnboardLayout>
  )
}
