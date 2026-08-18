import { useContext, useState } from 'react'
import Button from '../../../components/Button'
import Input from '../../../components/Input'
import Text from '../../../components/Text'
import { pasteFromClipboard } from '../../../lib/clipboard'
import { DEMO_RECOVERY_PUB } from '../../../lib/vault/setupPlan'
import SafeIcon from '../../../icons/Safe'
import { VaultContext } from '../../../providers/vault'
import { KeyCard, Reveal } from '../ui'
import { OnboardLayout } from './Layout'

export default function VaultRecovery() {
  const { allowDemoKeys, applyRecovery, error, navigate, setup, skipRecovery } = useContext(VaultContext)
  const [value, setValue] = useState(setup.recoveryPub)
  const [secret, setSecret] = useState('')

  return (
    <OnboardLayout
      title='Recovery key'
      step={3}
      total={6}
      error={error}
      onBack={() => navigate('hardware')}
      actions={
        <>
          <Button onClick={() => applyRecovery(value, secret)} label='Continue' />
          <Button onClick={skipRecovery} label='Skip for now' secondary />
          {allowDemoKeys ? (
            <Button
              onClick={() => applyRecovery(DEMO_RECOVERY_PUB, '', true)}
              label='Use a demo recovery key'
              secondary
            />
          ) : null}
        </>
      }
    >
      <Text wrap>
        Optional. If you lose this device or hardware, this key can start recovery. The others can cancel it during the
        wait. Skip and this vault is this device plus hardware.
      </Text>
      <KeyCard icon={<SafeIcon />} title='Recovery' role='Starts a waiting period. Not for daily spend.' />
      <Text color='neutral-600' tiny wrap>
        This is not the Recovery Kit. The kit is a file you’ll save later. It is not a seed and it does not hold this
        key.
      </Text>
      <Reveal label='Public key' defaultOpen>
        <Input label='Public key' placeholder='02… or 03…' value={value} onChange={setValue} testId='recovery-pub' />
        <Button onClick={async () => setValue((await pasteFromClipboard()) || value)} label='Paste' clear />
      </Reveal>
      <Reveal label='Secret to prove you hold it (optional now)'>
        <Input
          label='32-byte hex secret'
          placeholder='Proves this recovery key is yours'
          value={secret}
          onChange={setSecret}
          testId='recovery-secret'
        />
        <Text color='neutral-600' tiny wrap>
          Not stored on this phone. Needed only if you add recovery to a live vault.
        </Text>
      </Reveal>
    </OnboardLayout>
  )
}
