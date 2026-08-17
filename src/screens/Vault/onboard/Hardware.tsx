import { useContext, useEffect, useState } from 'react'
import Button from '../../../components/Button'
import Input from '../../../components/Input'
import Text from '../../../components/Text'
import { pasteFromClipboard } from '../../../lib/clipboard'
import { DEMO_HARDWARE_PUB } from '../../../lib/vault/setup'
import ShieldCheckOutlineIcon from '../../../icons/ShieldCheckOutline'
import { VaultContext } from '../../../providers/vault'
import { KeyCard, Reveal } from '../ui'
import { OnboardLayout } from './Layout'

export default function VaultHardware() {
  const { allowDemoKeys, applyHardware, error, navigate, setup, status } = useContext(VaultContext)
  const required = status?.externalOwnerWalletPub || ''
  const [value, setValue] = useState(required || (setup.hardwareIsDemo ? '' : setup.hardwarePub))

  useEffect(() => {
    if (required) setValue(required)
  }, [required])

  return (
    <OnboardLayout
      title='Which hardware?'
      step={2}
      error={error}
      onBack={() => navigate('design')}
      actions={
        <>
          <Button onClick={() => applyHardware(value)} label='Continue' />
          {required || !allowDemoKeys ? null : (
            <Button onClick={() => applyHardware(DEMO_HARDWARE_PUB, true)} label='Use a demo key' secondary />
          )}
        </>
      }
    >
      <Text wrap>
        {required
          ? 'This vault already has hardware. Confirm you hold that key.'
          : 'Which hardware owns this vault? With recovery, it can move everything. Never paste a seed.'}
      </Text>
      {required ? (
        <KeyCard
          icon={<ShieldCheckOutlineIcon />}
          title='Hardware'
          role='Already on this vault'
          fingerprint={required}
        />
      ) : null}
      <Reveal label='Public key' defaultOpen={!required}>
        <Input label='Public key' placeholder='02… or 03…' value={value} onChange={setValue} testId='hardware-pub' />
        <Button onClick={async () => setValue((await pasteFromClipboard()) || value)} label='Paste' clear />
        <Text color='neutral-600' tiny wrap>
          Starts with 02 or 03. Never paste a seed.
        </Text>
      </Reveal>
    </OnboardLayout>
  )
}
