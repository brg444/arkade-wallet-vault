export default function ProtectionModel({ compact = false }: { compact?: boolean }) {
  return (
    <section className={compact ? 'qg-model is-compact' : 'qg-model'} aria-label='How this Vault is protected'>
      <div className='qg-model-row'>
        <strong>Spending</strong>
        <span>Your passkey approves payments; the Vault service checks your limits</span>
      </div>
      <div className='qg-model-row'>
        <strong>Savings</strong>
        <span>Your passkey unlocks the first approval; your hardware wallet provides the second</span>
      </div>
      {compact ? null : (
        <p className='qg-model-note'>
          The next steps explain which keys you need for recovery, the waiting periods, and when the recovery services must be available.
        </p>
      )}
    </section>
  )
}
