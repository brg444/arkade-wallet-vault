import { useContext, useEffect, useState } from 'react'
import Button from '../../../components/Button'
import Input from '../../../components/Input'
import Text from '../../../components/Text'
import { pasteFromClipboard } from '../../../lib/clipboard'
import { DEMO_RECOVERY_PUB } from '../../../lib/vault/setup'
import { VaultContext } from '../../../providers/vault'
import { OnboardLayout } from './Layout'

export default function VaultRecovery() {
  const { applyRecovery, error, navigate, setup, status } = useContext(VaultContext)
  const required = status?.recoveryKeyPub || ''
  const [value, setValue] = useState(required || (setup.recoveryIsDemo ? '' : setup.recoveryPub))

  useEffect(() => {
    if (required) setValue(required)
  }, [required])

  return (
    <OnboardLayout
      title='Recovery key'
      step={3}
      error={error}
      onBack={() => navigate('hardware')}
      actions={
        <>
          <Button onClick={() => applyRecovery(value)} label='I control this key' />
          {required ? null : (
            <Button onClick={() => applyRecovery(DEMO_RECOVERY_PUB, true)} label='Use a demo recovery key' secondary />
          )}
        </>
      }
    >
      <Text wrap>
        {required
          ? 'Recovery is already bound on this Mutinynet vault. Confirm you control the key below. After the delay it can recover funds without the phone.'
          : 'Add a second offline key. After the delay you choose, this key alone can recover spending or savings if the phone is lost. It must not be the same as the hardware key.'}
      </Text>
      <Input
        label='Compressed public key'
        placeholder='02… or 03…'
        value={value}
        onChange={setValue}
        testId='recovery-pub'
      />
      <Button onClick={async () => setValue((await pasteFromClipboard()) || value)} label='Paste' clear />
      <Text color='neutral-600' tiny wrap>
        Keep this key on a different device or backup than the hardware wallet. Demo recovery is the well-known test key
        and is not yours.
      </Text>
    </OnboardLayout>
  )
}
