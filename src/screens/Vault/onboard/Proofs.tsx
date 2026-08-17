import { useContext, useState } from 'react'
import Button from '../../../components/Button'
import Input from '../../../components/Input'
import Text from '../../../components/Text'
import { pasteFromClipboard } from '../../../lib/clipboard'
import { loadStagedEnrollment } from '../../../lib/vault/enrollment'
import { VaultContext } from '../../../providers/vault'
import { Detail, Reveal } from '../ui'
import { OnboardLayout } from './Layout'

export default function VaultProofs() {
  const { busy, error, navigate, submitEnrollmentProofs } = useContext(VaultContext)
  const staged = loadStagedEnrollment()
  const [ownerProof, setOwnerProof] = useState('')
  const [recoveryProof, setRecoveryProof] = useState('')
  return (
    <OnboardLayout
      title='Approve this vault'
      step={7}
      error={error}
      onBack={() => navigate('passkey')}
      actions={
        <Button
          onClick={() => void submitEnrollmentProofs(ownerProof, recoveryProof)}
          disabled={busy || ownerProof.trim().length < 128 || recoveryProof.trim().length < 128}
          label={busy ? 'Checking…' : 'Finish setup'}
        />
      }
    >
      <Text wrap>
        Confirm where money will land. Then sign once with hardware and recovery — never paste those private keys.
      </Text>
      <Detail label='Spending' value={staged?.operationalAddress || 'Not proposed yet'} mono />
      <Detail label='Savings' value={staged?.savingsAddress || 'Not proposed yet'} mono />
      {staged?.vaultId ? <Detail label='Vault' value={staged.vaultId} /> : null}
      <Text color='neutral-600' tiny wrap>
        This phone cannot spend Savings.
      </Text>
      <Reveal label='What to sign'>
        <Text color='neutral-600' tiny wrap>
          {staged?.popDigest || 'Create a passkey first.'}
        </Text>
      </Reveal>
      <Input
        label='Hardware signature'
        value={ownerProof}
        onChange={setOwnerProof}
        placeholder='Paste signature'
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
        placeholder='Paste signature'
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
