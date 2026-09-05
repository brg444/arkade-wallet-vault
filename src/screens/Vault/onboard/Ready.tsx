import { useContext } from 'react'
import { VaultContext } from '../../../vault/context'
import { useBackupConfirmation } from '../qg/useBackupConfirmation'
import QgScreen, { QgCheck, QgPrimary, QgTextButton } from '../qg/QgScreen'
import '../qg/guidance.css'

export default function VaultReady() {
  const { navigate, networkLabel } = useContext(VaultContext)
  const { confirmed } = useBackupConfirmation()
  return (
    <QgScreen
      variant='success'
      footer={
        <>
          <QgPrimary onClick={() => navigate('home')} label='Open your Vault' />
          {!confirmed ? <QgTextButton onClick={() => navigate('kit')} label='Save a separate kit copy' /> : null}
        </>
      }
    >
      <div className='qg-centered qg-success-screen'>
        <div className='qg-success-label'>
          <span>
            <QgCheck />
          </span>
          <p>Vault created</p>
        </div>
        <h1>Your vault is ready to use</h1>
        <p className='qg-copy'>You can now receive bitcoin into Spending or Savings on {networkLabel}.</p>
        <section className='qg-next'>
          <strong>Your setup</strong>
          <span>
            <QgCheck />
            Savings transfers need your passkey and hardware wallet
          </span>
          <span>
            <QgCheck />
            Your Spending limits are registered
          </span>
        </section>
        <p className='qg-backup-status' data-testid='backup-status'>
          {confirmed
            ? 'You confirmed a Recovery Kit copy outside this device.'
            : 'Backup reminder: save a Recovery Kit copy outside this device.'}
        </p>
      </div>
    </QgScreen>
  )
}
