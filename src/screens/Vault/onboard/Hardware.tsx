import { useContext, useState } from 'react'
import Button from '../../../components/Button'
import Input from '../../../components/Input'
import Text from '../../../components/Text'
import { pasteFromClipboard } from '../../../lib/clipboard'
import { DEMO_HARDWARE_PUB } from '../../../lib/vault/setup'
import { VaultContext } from '../../../providers/vault'
import { OnboardLayout } from './Layout'

export default function VaultHardware() {
  const { applyHardware, error, navigate, setup } = useContext(VaultContext)
  const [value, setValue] = useState(setup.hardwareIsDemo ? '' : setup.hardwarePub)

  return (
    <OnboardLayout
      title='Hardware path'
      step={2}
      error={error}
      onBack={() => navigate('design')}
      actions={
        <>
          <Button onClick={() => applyHardware(value)} label='Use this key' />
          <Button onClick={() => applyHardware(DEMO_HARDWARE_PUB, true)} label='Use a demo key for now' secondary />
        </>
      }
    >
      <Text wrap>
        Add the public key of a hardware wallet or another external signer. This is the only path that can fully sweep
        or change the vault, and it never lives in this phone.
      </Text>
      <Input
        label='Compressed public key'
        placeholder='02… or 03…'
        value={value}
        onChange={setValue}
        testId='hardware-pub'
      />
      <Button onClick={async () => setValue((await pasteFromClipboard()) || value)} label='Paste' clear />
      <Text color='neutral-600' tiny wrap>
        Export a compressed secp256k1 public key from the device. Do not paste a seed or private key. A demo key is
        public and is not protection.
      </Text>
    </OnboardLayout>
  )
}
