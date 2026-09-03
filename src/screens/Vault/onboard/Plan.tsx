import { useContext, useState } from 'react'
import { prettyNumber } from '../../../lib/format'
import { fingerprint } from '../../../lib/vault/hex'
import { VaultContext } from '../../../vault/context'
import QgScreen, { QgPrimary } from '../qg/QgScreen'

function shortPub(pub: string) {
  return pub ? fingerprint(pub, 2) : 'Not enrolled'
}

export default function VaultPlan() {
  const { finishPlan, navigate, setup } = useContext(VaultContext)
  const [consented, setConsented] = useState(false)
  const advanced = setup.protectionTier === 'advanced'

  return (
    <QgScreen
      title='Review'
      stepLabel='5 of 6'
      back={() => navigate('conditions')}
      footer={<QgPrimary onClick={finishPlan} disabled={!consented} label='Continue' />}
    >
      <p className='qg-eyebrow'>Ready to enroll</p>
      <h1>Review your Vault</h1>
      <section className='qg-summary'>
        <div>
          <span>Network</span>
          <strong>Mutinynet</strong>
        </div>
        <div>
          <span>Protection</span>
          <strong>{advanced ? 'Advanced' : 'Standard'}</strong>
        </div>
        <div>
          <span>Hardware key</span>
          <strong>{shortPub(setup.hardwarePub)}</strong>
        </div>
        <div>
          <span>Recovery key</span>
          <strong>{advanced ? shortPub(setup.recoveryPub) : 'Not enrolled'}</strong>
        </div>
        <div>
          <span>Per payment</span>
          <strong>{prettyNumber(setup.txCapSats, 0)} ₿SATS</strong>
        </div>
        <div>
          <span>Rolling 24 hours</span>
          <strong>{prettyNumber(setup.dailyLimitSats, 0)} ₿SATS</strong>
        </div>
        <div>
          <span>Vault design</span>
          <strong>Will enroll vault-board-v1</strong>
        </div>
      </section>
      <label className='qg-consent'>
        <input type='checkbox' checked={consented} onChange={(event) => setConsented(event.target.checked)} />
        <span>I understand these limits are enrolled with this Vault and cannot be changed after setup.</span>
      </label>
    </QgScreen>
  )
}
