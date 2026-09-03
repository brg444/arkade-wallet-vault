import { useContext } from 'react'
import { VaultContext } from '../../../vault/context'
import QgScreen, { QgCheck, QgPrimary } from '../qg/QgScreen'

export default function VaultReady() {
  const { navigate } = useContext(VaultContext)
  return (
    <QgScreen variant='success' footer={<QgPrimary onClick={() => navigate('home')} label='Open your Vault' />}>
      <div className='qg-centered qg-success-screen'>
        <div className='qg-success-label'>
          <span>
            <QgCheck />
          </span>
          <p>Ready</p>
        </div>
        <h1>
          Your money has
          <br />a guardian
        </h1>
        <p className='qg-copy'>Spending and Savings are ready on Mutinynet.</p>
        <section className='qg-next'>
          <strong>Ready on this device</strong>
          <span>
            <QgCheck />
            Recovery Kit available
          </span>
          <span>
            <QgCheck />
            Spending limits enrolled
          </span>
          <span>
            <QgCheck />
            Passkey active
          </span>
        </section>
      </div>
    </QgScreen>
  )
}
