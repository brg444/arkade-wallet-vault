import { useContext, useEffect, useState } from 'react'
import Button from '../../../components/Button'
import Input from '../../../components/Input'
import Text from '../../../components/Text'
import { pasteFromClipboard } from '../../../lib/clipboard'
import { delayLabel } from '../../../lib/vault/policy'
import { DEMO_RECOVERY_PUB } from '../../../lib/vault/setup'
import SafeIcon from '../../../icons/Safe'
import { VaultContext } from '../../../providers/vault'
import { KeyCard, Reveal } from '../ui'
import { OnboardLayout } from './Layout'

export default function VaultRecovery() {
  const { applyRecovery, error, liveNetwork, navigate, setup, status } = useContext(VaultContext)
  const required = status?.recoveryKeyPub || ''
  const [value, setValue] = useState(required || (setup.recoveryIsDemo ? '' : setup.recoveryPub))
  const wait = delayLabel(status?.operationalCsvBlocks || setup.operationalCsvBlocks, status?.network)

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
          ? `Recovery is already bound on this vault. After ${wait} it can move spending without the phone. It is not a cloud backup of the passkey.`
          : 'Add a second offline key, kept away from the hardware wallet. After a delay it can recover funds if this phone is gone.'}
      </Text>
      {required ? (
        <KeyCard
          icon={<SafeIcon />}
          title='Bound recovery key'
          role={liveNetwork ? 'Delayed path if the phone is lost' : 'Recovery'}
          fingerprint={required}
          status='Needs your confirm'
        />
      ) : null}
      <Reveal label='Show key details' defaultOpen={!required}>
        <Input
          label='Compressed public key'
          placeholder='02… or 03…'
          value={value}
          onChange={setValue}
          testId='recovery-pub'
        />
        <Button onClick={async () => setValue((await pasteFromClipboard()) || value)} label='Paste' clear />
        <Text color='neutral-600' tiny wrap>
          Keep this key on a different device than the hardware wallet. Demo recovery is a well-known test key and is
          not yours.
        </Text>
      </Reveal>
    </OnboardLayout>
  )
}
