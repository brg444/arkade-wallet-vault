import { useContext } from 'react'
import { TicketX } from 'lucide-react'
import { VaultContext } from '../../../vault/context'
import QgScreen, { QgPrimary, QgSecondary } from '../qg/QgScreen'

export default function VaultProblem() {
  const { error, navigate } = useContext(VaultContext)
  return (
    <QgScreen
      title='Can’t continue'
      back={() => navigate('passkey')}
      footer={
        <>
          <QgPrimary onClick={() => navigate('passkey')} label='Try another code' />
          <QgSecondary onClick={() => navigate('passkey')} label='Try again' />
        </>
      }
    >
      <p className='qg-eyebrow'>Invite code</p>
      <h1>This invite can’t be used</h1>
      <p className='qg-copy'>
        {error || 'It may have expired or already been used. Ask for a new invite, then try again.'}
      </p>
      <section className='qg-alert'>
        <TicketX />
        <div>
          <strong>Invite unavailable</strong>
          <p>No enrollment was created and this device was not changed.</p>
        </div>
      </section>
    </QgScreen>
  )
}
