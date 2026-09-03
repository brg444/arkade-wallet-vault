import { useContext } from 'react'
import { VaultContext } from '../../../vault/context'
import ProtectionModel from '../qg/ProtectionModel'
import QgScreen, { QgPrimary } from '../qg/QgScreen'

export default function VaultDesign() {
  const { acceptDesign, navigate } = useContext(VaultContext)
  return (
    <QgScreen
      title='How it works'
      stepLabel='1 of 6'
      back={() => navigate('welcome')}
      footer={<QgPrimary onClick={acceptDesign} label='Continue' />}
    >
      <p className='qg-eyebrow'>Protection by purpose</p>
      <h1>Different money needs different protection</h1>
      <p className='qg-copy'>
        Limits reduce the impact of a compromised device. Savings requires two independent keys, with delayed recovery
        if one is lost.
      </p>
      <ProtectionModel />
    </QgScreen>
  )
}
