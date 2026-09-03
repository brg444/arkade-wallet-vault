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
          Your bitcoin is
          <br />
          ready—and protected
        </h1>
        <p className='qg-copy'>Your safeguards are active. You can now use Spending and Savings on Mutinynet.</p>
        <section className='qg-next'>
          <strong>Ready on this device</strong>
          <span>
            <QgCheck />
            Loss recovery is ready
          </span>
          <span>
            <QgCheck />
            Savings requires two keys
          </span>
          <span>
            <QgCheck />
            Spending limits are active
          </span>
        </section>
      </div>
    </QgScreen>
  )
}
