import { useContext, useState } from 'react'
import Button from '../../../components/Button'
import Input from '../../../components/Input'
import Text from '../../../components/Text'
import { pasteFromClipboard } from '../../../lib/clipboard'
import { loadStagedEnrollment } from '../../../lib/vault/enrollment'
import { VaultContext } from '../../../providers/vault'
import { OnboardLayout } from './Layout'

export default function VaultProofs() {
  const { busy, error, navigate, submitEnrollmentProofs } = useContext(VaultContext)
  const staged = loadStagedEnrollment()
  const [ownerProof, setOwnerProof] = useState('')
  const [recoveryProof, setRecoveryProof] = useState('')
  return (
    <OnboardLayout
      title='Authorize'
      step={7}
      error={error}
      onBack={() => navigate('passkey')}
      actions={
        <Button
          onClick={() => void submitEnrollmentProofs(ownerProof, recoveryProof)}
          disabled={busy || ownerProof.trim().length < 128 || recoveryProof.trim().length < 128}
          label={busy ? 'Checking signatures…' : 'Finish setup'}
        />
      }
    >
      <Text wrap>
        Sign this digest with the hardware and recovery keys you already pasted. Paste the two 64-byte BIP340
        signatures. Do not paste private keys.
      </Text>
      <Text color='neutral-600' tiny wrap>
        Spending address {staged?.operationalAddress || 'not proposed yet'}
      </Text>
      <Text color='neutral-600' tiny wrap>
        Digest {staged?.popDigest || '—'}
      </Text>
      <Input
        label='Hardware signature'
        value={ownerProof}
        onChange={setOwnerProof}
        placeholder='64-byte hex'
        testId='owner-proof'
      />
      <Button
        onClick={async () => setOwnerProof((await pasteFromClipboard()) || ownerProof)}
        label='Paste hardware signature'
        clear
      />
      <Input
        label='Recovery signature'
        value={recoveryProof}
        onChange={setRecoveryProof}
        placeholder='64-byte hex'
        testId='recovery-proof'
      />
      <Button
        onClick={async () => setRecoveryProof((await pasteFromClipboard()) || recoveryProof)}
        label='Paste recovery signature'
        clear
      />
    </OnboardLayout>
  )
}
