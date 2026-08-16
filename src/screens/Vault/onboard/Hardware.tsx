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
  const { applyHardware, error, liveNetwork, navigate, setup, status } = useContext(VaultContext)
  const required = status?.externalOwnerWalletPub || ''
  const [value, setValue] = useState(required || (setup.hardwareIsDemo ? '' : setup.hardwarePub))

  useEffect(() => {
    if (required) setValue(required)
  }, [required])

  return (
    <OnboardLayout
      title='Hardware path'
      step={2}
      error={error}
      onBack={() => navigate('design')}
      actions={
        <>
          <Button onClick={() => applyHardware(value)} label='I control this key' />
          {required ? null : (
            <Button onClick={() => applyHardware(DEMO_HARDWARE_PUB, true)} label='Use a demo key for now' secondary />
          )}
        </>
      }
    >
      <Text wrap>
        {required
          ? 'This Mutinynet vault is already bound to one hardware key. Confirm you can sign with that wallet. The phone will never hold its private key.'
          : 'Pair the public key of a hardware wallet or another external signer. Together with recovery it can sweep everything. It never lives in this phone.'}
      </Text>
      {required ? (
        <KeyCard
          icon={<ShieldCheckOutlineIcon />}
          title='Bound hardware key'
          role={liveNetwork ? 'Already configured on this vault' : 'Hardware / external'}
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
          testId='hardware-pub'
        />
        <Button onClick={async () => setValue((await pasteFromClipboard()) || value)} label='Paste' clear />
        <Text color='neutral-600' tiny wrap>
          Export a compressed public key from the device. Do not paste a seed or private key. A demo key is public and
          is not protection.
        </Text>
      </Reveal>
    </OnboardLayout>
  )
}
