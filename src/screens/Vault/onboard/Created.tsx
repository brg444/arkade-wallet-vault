import { useContext } from 'react'
import { fingerprint } from '../../../lib/vault/hex'
import { VaultContext } from '../../../vault/context'
import QgScreen, { QgCheck, QgPrimary } from '../qg/QgScreen'

export default function VaultCreated() {
  const { navigate, setup, status } = useContext(VaultContext)
  const vaultId = status?.vaultId || ''
  const advanced = (status?.protectionTier || setup.protectionTier) === 'advanced'

  return (
    <QgScreen variant='success' footer={<QgPrimary onClick={() => navigate('kit')} label='Save Recovery Kit' />}>
      <div className='qg-centered qg-success-screen'>
        <div className='qg-success-label'>
          <span>
            <QgCheck />
          </span>
          <p>Enrollment complete</p>
        </div>
        <h1>
          Your Vault
          <br />
          was created
        </h1>
        <p className='qg-copy'>The service returned the committed Vault facts and this device verified them.</p>
        <section className='qg-next'>
          <strong>Confirmed after enrollment</strong>
          <span>
            <QgCheck />
            Vault {vaultId ? `QV-${fingerprint(vaultId, 2)}` : 'enrolled'}
          </span>
          <span>
            <QgCheck />
            {advanced ? 'Advanced protection enrolled' : 'Standard protection enrolled'}
          </span>
          <span>
            <QgCheck />
            vault-board-v1 verified
          </span>
        </section>
      </div>
    </QgScreen>
  )
}
