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
            <Button onClick={() => applyRecovery(value)} label='Add recovery' />
            <Button onClick={skipRecovery} label='Skip for now' secondary />
          </>
        ) : (
          <Button onClick={skipRecovery} label='Skip for now' />
        )
      }
    >
      <Text wrap>
        Optional. If you lose this device or hardware, this key starts a waiting period. The others can cancel it if
        that wasn’t you. Skip and this vault stays this device plus hardware.
      </Text>
      <KeyCard icon={<SafeIcon />} title='Recovery' role='Starts a wait you can cancel. Not for daily spend.' />
      <Text color='neutral-600' tiny wrap>
        This is not the Recovery Kit. The kit is a file you’ll save later. It is not a seed and it does not hold this
        key.
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
