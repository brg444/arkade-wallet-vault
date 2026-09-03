import { useContext } from 'react'
import { Download, LockKeyhole } from 'lucide-react'
import { useToast } from '../../../components/Toast'
import { VaultContext } from '../../../vault/context'
import QgScreen, { QgCheck, QgMark, QgPrimary, QgTextButton } from '../qg/QgScreen'

function downloadJson(name: string, body: string) {
  const hidden = document.createElement('a')
  hidden.href = URL.createObjectURL(new Blob([body], { type: 'application/json' }))
  hidden.download = name
  document.body.appendChild(hidden)
  hidden.click()
  hidden.remove()
}

export default function VaultKit() {
  const { downloadRecoveryKit, navigate } = useContext(VaultContext)
  const { toast } = useToast()

  const save = () => {
    try {
      downloadJson('Recovery Kit.json', downloadRecoveryKit())
      toast('Recovery Kit saved')
      navigate('ready')
    } catch {
      toast('No Recovery Kit yet')
    }
  }

  return (
    <QgScreen
      title='Recovery Kit'
      stepLabel='Vault created'
      back={() => navigate('created')}
      footer={
        <>
          <QgPrimary onClick={save} icon={<Download />} label='Save Recovery Kit' testId='download-recovery-kit' />
          <QgTextButton onClick={() => navigate('ready')} label='I already saved it' />
        </>
      }
    >
      <p className='qg-eyebrow'>Keep this somewhere safe</p>
      <h1>Save your Recovery Kit</h1>
      <p className='qg-copy'>
        This public vault map lets recovery software rebuild the correct addresses and recovery paths. It contains no
        private keys and cannot move bitcoin by itself.
      </p>
      <section className='qg-document'>
        <QgMark />
        <div>
          <strong>Recovery Kit</strong>
          <small>Public vault map · no private keys</small>
        </div>
        <LockKeyhole />
      </section>
      <div className='qg-checks'>
        <span>
          <QgCheck />
          Save it outside this device
        </span>
        <span>
          <QgCheck />
          Keep a second durable copy
        </span>
      </div>
    </QgScreen>
  )
}
