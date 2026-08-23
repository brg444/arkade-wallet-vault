import { useContext, useState } from 'react'
import Button from '../../../components/Button'
import Input from '../../../components/Input'
import Text from '../../../components/Text'
import { pasteFromClipboard } from '../../../lib/clipboard'
import SafeIcon from '../../../icons/Safe'
import { VaultContext } from '../../../vault/context'
import { KeyCard } from '../ui'
import { OnboardLayout } from './Layout'

export default function VaultRecovery() {
  const { applyRecovery, error, navigate, setup, skipRecovery } = useContext(VaultContext)
  const [value, setValue] = useState(setup.recoveryPub)
  const hasKey = value.trim().length > 0

  return (
    <OnboardLayout
      title='Recovery'
      step={3}
      total={6}
      error={error}
      onBack={() => navigate('hardware')}
      actions={
        hasKey ? (
          <>
            <Button onClick={() => applyRecovery(value)} label='Add recovery key' />
            <Button onClick={skipRecovery} label='Skip for now' secondary />
          </>
        ) : (
          <Button onClick={skipRecovery} label='Skip for now' />
        )
      }
    >
      <Text wrap>
        Optional. This key can start a waiting period if you lose this device or hardware. The keys you still have can
        cancel a recovery you didn’t start.
      </Text>
      <KeyCard icon={<SafeIcon />} title='Recovery' role='Starts a wait you can cancel. Not for daily spend.' />
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
    </OnboardLayout>
  )
}
