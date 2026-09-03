export default function VaultCreating() {
  return (
    <div className='qg-screen qg-screen-progress'>
      <main className='qg-main qg-centered qg-progress-screen'>
        <span className='qg-spinner' aria-hidden='true' />
        <p className='qg-eyebrow'>Creating your Vault</p>
        <h1>Securing the keys</h1>
        <p className='qg-copy'>Keep this screen open. Enrollment usually takes less than a minute.</p>
        <div className='qg-progress'>
          <span />
        </div>
        <small>Enrolling protection · 2 of 3</small>
      </main>
    </div>
  )
}
