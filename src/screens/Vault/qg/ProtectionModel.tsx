export default function ProtectionModel({ compact = false }: { compact?: boolean }) {
  return (
    <section className={compact ? 'qg-model is-compact' : 'qg-model'} aria-label='How this Vault is protected'>
      <div className='qg-model-row'>
        <strong>Spending</strong>
        <span>Passkey and service-enforced limits contain exposure</span>
      </div>
      <div className='qg-model-row'>
        <strong>Savings</strong>
        <span>This device and an independent hardware key</span>
      </div>
      {compact ? null : (
        <p className='qg-model-note'>
          If one key is lost, delayed recovery preserves access and gives you time to cancel abuse.
        </p>
      )}
    </section>
  )
}
