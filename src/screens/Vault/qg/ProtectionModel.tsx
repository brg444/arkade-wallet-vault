export default function ProtectionModel({ compact = false }: { compact?: boolean }) {
  return (
    <section className={compact ? 'qg-model is-compact' : 'qg-model'} aria-label='How this Vault is protected'>
      <div className='qg-model-row'>
        <strong>Spending</strong>
        <span>Passkey and Vault service, within your limits</span>
      </div>
      <div className='qg-model-row'>
        <strong>Savings</strong>
        <span>Passkey, then your hardware key</span>
      </div>
      {compact ? null : <p className='qg-model-note'>Your hardware key can cancel a recovery you did not start.</p>}
    </section>
  )
}
