import { useContext } from 'react'
import { VaultContext } from '../../../vault/context'
import QgScreen, { QgCheck, QgPrimary } from '../qg/QgScreen'

export default function VaultCreated() {
  const { navigate, setup, status } = useContext(VaultContext)
  const advanced = (status?.protectionTier || setup.protectionTier) === 'advanced'

  return (
    <QgScreen variant='success' footer={<QgPrimary onClick={() => navigate('kit')} label='Save Recovery Kit' />}>
      <div className='qg-centered qg-success-screen'>
        <div className='qg-success-label'>
          <span>
            <QgCheck />
          </span>
          <p>Vault created</p>
        </div>
        <h1>
          Your Vault
          <br />
          was created
        </h1>
        <p className='qg-copy'>
          Your keys and Spending limits are registered. Next, save the Recovery Kit for this vault outside this device.
        </p>
        <section className='qg-next'>
          <strong>Registered for this vault</strong>
          <span>
            <QgCheck />
            Savings uses your passkey and hardware key
          </span>
          <span>
            <QgCheck />
            {advanced ? 'Separate recovery key enrolled' : 'Standard selected; no separate recovery key'}
          </span>
          <span>
            <QgCheck />
            Spending limits locked in
          </span>
        </section>
      </div>
    </QgScreen>
  )
}
