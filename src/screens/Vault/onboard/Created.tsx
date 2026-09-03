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
          <p>Enrollment complete</p>
        </div>
        <h1>
          Your Vault
          <br />
          was created
        </h1>
        <p className='qg-copy'>Your protection choices are enrolled and verified on this device.</p>
        <section className='qg-next'>
          <strong>Your safeguards</strong>
          <span>
            <QgCheck />
            Savings requires this device and hardware
          </span>
          <span>
            <QgCheck />
            {advanced ? 'Separate recovery key enrolled' : 'One-lost-key recovery active'}
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
