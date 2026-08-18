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
  const { allowDemoKeys, applyRecovery, error, navigate, setup } = useContext(VaultContext)
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
        Required paper key. It starts a hold on a new output. Guardians can send that hold to a vault that excludes this
        key. It cannot take mature Savings until the hold confirms and the wait finishes.
      </Text>
      <KeyCard icon={<SafeIcon />} title='Recovery' role='Break-glass. Not a daily cosigner.' />
      <Reveal label='Public key' defaultOpen>
        <Input label='Public key' placeholder='02… or 03…' value={value} onChange={setValue} testId='recovery-pub' />
        <Button onClick={async () => setValue((await pasteFromClipboard()) || value)} label='Paste' clear />
      </Reveal>
      <Reveal label='Secret for proof (optional now)'>
        <Input
          label='32-byte hex secret'
          placeholder='Used at enroll to sign the descriptor'
          value={secret}
          onChange={setSecret}
          testId='recovery-secret'
        />
        <Text color='neutral-600' tiny wrap>
          Not stored. Needed when the authorizer returns the v5 descriptor hash.
        </Text>
      </Reveal>
    </OnboardLayout>
  )
}
