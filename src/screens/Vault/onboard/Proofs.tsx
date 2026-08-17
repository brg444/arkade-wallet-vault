import { useContext, useState } from 'react'
import Button from '../../../components/Button'
import Input from '../../../components/Input'
import Text from '../../../components/Text'
import { useToast } from '../../../components/Toast'
import { copyToClipboard, pasteFromClipboard } from '../../../lib/clipboard'
import { loadStagedEnrollment } from '../../../lib/vault/enrollment'
import { VaultContext } from '../../../providers/vault'
import { Detail } from '../ui'
import { OnboardLayout } from './Layout'

export default function VaultProofs() {
  const { busy, error, navigate, submitEnrollmentProofs } = useContext(VaultContext)
  const { toast } = useToast()
  const staged = loadStagedEnrollment()
  const [ownerProof, setOwnerProof] = useState('')
  const [recoveryProof, setRecoveryProof] = useState('')
  const message = staged?.popDigest || ''

  const paste = async (into: 'hardware' | 'recovery') => {
    const next = (await pasteFromClipboard()) || ''
    if (!next) return
    if (into === 'hardware') setOwnerProof(next)
    else setRecoveryProof(next)
  }

  return (
    <OnboardLayout
      title='Approve this vault'
      step={7}
      total={7}
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
        Face ID only made the daily key. Hardware and recovery still have to say this vault is yours — once.
      </Text>
      <Text wrap>
        Copy the message below. Sign it with each of those two keys in your wallet. Paste the two signatures here, not
        the keys themselves.
      </Text>
      <Detail label='Spending' value={staged?.operationalAddress || 'Not proposed yet'} mono />
      <Detail label='Savings' value={staged?.savingsAddress || 'Not proposed yet'} mono />
      {staged?.vaultId ? <Detail label='Vault' value={staged.vaultId} /> : null}
      <Text color='neutral-600' tiny wrap>
        This phone cannot spend Savings.
      </Text>
      <div>
        <Text color='neutral-600' tiny>
          Message to sign
        </Text>
        <button
          type='button'
          className='vault-sign-message'
          data-testid='enrollment-pop'
          onClick={() => {
            if (!message) return
            void copyToClipboard(message)
            toast('Message copied')
          }}
        >
          {message || 'Create a passkey first.'}
        </button>
      </div>
      <Input
        label='Hardware signed it'
        value={ownerProof}
        onChange={setOwnerProof}
        placeholder='Paste the hardware signature'
        testId='owner-proof'
        right={
          <button type='button' className='vault-inline-paste' onClick={() => void paste('hardware')}>
            Paste
          </button>
        }
      />
      <Input
        label='Recovery signed it'
        value={recoveryProof}
        onChange={setRecoveryProof}
        placeholder='Paste the recovery signature'
        testId='recovery-proof'
        right={
          <button type='button' className='vault-inline-paste' onClick={() => void paste('recovery')}>
            Paste
          </button>
        }
      />
    </OnboardLayout>
  )
}
