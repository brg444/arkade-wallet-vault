import { useContext, useEffect, useState } from 'react'
import Button from '../../../components/Button'
import Input from '../../../components/Input'
import Text from '../../../components/Text'
import { pasteFromClipboard } from '../../../lib/clipboard'
import { waitLabel } from '../../../lib/vault/policy'
import { DEMO_RECOVERY_PUB } from '../../../lib/vault/setup'
import SafeIcon from '../../../icons/Safe'
import { VaultContext } from '../../../providers/vault'
import { KeyCard, Reveal } from '../ui'
import { OnboardLayout } from './Layout'

export default function VaultRecovery() {
  const { allowDemoKeys, applyRecovery, error, navigate, setup, status } = useContext(VaultContext)
  const required = status?.recoveryKeyPub || ''
  const [value, setValue] = useState(required || (setup.recoveryIsDemo ? '' : setup.recoveryPub))
  const wait = waitLabel(status?.operationalCsvBlocks || setup.operationalCsvBlocks, status?.network)

  useEffect(() => {
    if (required) setValue(required)
  }, [required])

  return (
    <OnboardLayout
      title='Who can replace the phone?'
      step={3}
      error={error}
      onBack={() => navigate('hardware')}
      actions={
        <>
          <Button onClick={() => applyRecovery(value)} label='Continue' />
          {required || !allowDemoKeys ? null : (
            <Button onClick={() => applyRecovery(DEMO_RECOVERY_PUB, true)} label='Use a demo key' secondary />
          )}
        </>
      }
    >
      <Text wrap>
        {required
          ? `This vault already has recovery. After ${wait} it can replace this phone.`
          : `A second key, different from hardware. After ${wait} it can replace this phone.`}
      </Text>
      {required ? (
        <KeyCard icon={<SafeIcon />} title='Recovery' role='Already on this vault' fingerprint={required} />
      ) : null}
      <Reveal label='Public key' defaultOpen={!required}>
        <Input label='Public key' placeholder='02… or 03…' value={value} onChange={setValue} testId='recovery-pub' />
        <Button onClick={async () => setValue((await pasteFromClipboard()) || value)} label='Paste' clear />
        <Text color='neutral-600' tiny wrap>
          Keep this off the hardware wallet. Never paste a seed.
        </Text>
      </Reveal>
    </OnboardLayout>
  )
}
