import { useEffect, useRef, useState } from 'react'
import { ArrowDownToLine, ChevronRight, Share, X } from 'lucide-react'
import { QgPrimary } from './QgScreen'
import './install-notice.css'

type InstallEvent = Event & {
  prompt: () => Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const installedMode = () =>
  window.matchMedia('(display-mode: standalone)').matches ||
  Boolean((navigator as Navigator & { standalone?: boolean }).standalone)

export default function InstallNotice() {
  const [installed, setInstalled] = useState(installedMode)
  const [open, setOpen] = useState(false)
  const [prompt, setPrompt] = useState<InstallEvent | null>(null)
  const [installing, setInstalling] = useState(false)
  const [installError, setInstallError] = useState(false)
  const dialog = useRef<HTMLDialogElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const ios =
    /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  const android = /Android/i.test(navigator.userAgent)

  useEffect(() => {
    const mode = window.matchMedia('(display-mode: standalone)')
    const updateMode = () => setInstalled(installedMode())
    const onInstalled = () => {
      setInstalled(true)
      setPrompt(null)
      setOpen(false)
    }
    const onPrompt = (event: Event) => {
      if (typeof (event as InstallEvent).prompt !== 'function') return
      event.preventDefault()
      setPrompt(event as InstallEvent)
      setInstallError(false)
    }
    mode.addEventListener('change', updateMode)
    window.addEventListener('pageshow', updateMode)
    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      mode.removeEventListener('change', updateMode)
      window.removeEventListener('pageshow', updateMode)
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  useEffect(() => {
    const node = dialog.current
    if (open && !installed) node?.showModal()
    else if (node?.open) node.close()
  }, [open, installed])

  const install = async () => {
    if (!prompt || installing) return
    // The browser event can be used once, including when installation is dismissed.
    const event = prompt
    setPrompt(null)
    setInstalling(true)
    try {
      const choice = await event.prompt()
      if (choice.outcome === 'accepted') setOpen(false)
    } catch {
      setInstallError(true)
    } finally {
      setInstalling(false)
    }
  }

  if (installed) return null

  return (
    <>
      <button
        ref={trigger}
        className='qg-install-notice'
        type='button'
        onClick={() => setOpen(true)}
        aria-haspopup='dialog'
      >
        <ArrowDownToLine aria-hidden='true' />
        <span>
          <strong>Install Vaulted</strong>
          <small>Your wallet, one tap from your Home Screen.</small>
        </span>
        <ChevronRight aria-hidden='true' />
      </button>
      <dialog
        ref={dialog}
        className='qg-install-sheet'
        aria-labelledby='install-title'
        onClose={() => {
          setOpen(false)
          trigger.current?.focus({ preventScroll: true })
        }}
      >
        <div className='qg-install-heading'>
          <img src='/vaulted-icon.svg' width='48' height='48' alt='' />
          <button type='button' aria-label='Close install guide' onClick={() => setOpen(false)}>
            <X aria-hidden='true' />
          </button>
        </div>
        <h2 id='install-title'>Install Vaulted</h2>
        <p>Open Vaulted from its own icon, with more space for your wallet and no browser address bar.</p>
        {ios ? (
          <ol>
            <li>
              Open this page in <strong>Safari</strong>.
            </li>
            <li>
              Open <strong>Share</strong> <Share className='qg-install-inline-icon' aria-hidden='true' /> in the browser
              menu, then choose <strong>Add to Home Screen</strong>.
            </li>
            <li>
              Keep <strong>Open as Web App</strong> on if shown, then tap <strong>Add</strong>.
            </li>
            <li>
              Open the <strong>Vaulted</strong> icon to continue setup or sign in.
            </li>
          </ol>
        ) : android ? (
          <ol>
            <li>
              Open this page in <strong>Chrome</strong>.
            </li>
            <li>
              Open the browser menu and choose <strong>Add to Home screen</strong> or <strong>Install app</strong>.
            </li>
            <li>
              Confirm installation, then open the <strong>Vaulted</strong> icon to continue setup or sign in.
            </li>
          </ol>
        ) : (
          <p className='qg-install-instructions'>
            In Chrome or Edge, look for the install option in the address bar or browser menu. In Safari on Mac, choose{' '}
            <strong>File → Add to Dock</strong>. If your browser has no install option, open this page in Chrome or
            Edge.
          </p>
        )}
        {installError ? <p role='status'>The install prompt could not open. Use the browser steps above.</p> : null}
        {prompt || installing ? (
          <QgPrimary label='Install Vaulted' loading={installing} onClick={() => void install()} />
        ) : null}
        <button className='qg-text' type='button' onClick={() => setOpen(false)}>
          Continue in browser
        </button>
      </dialog>
    </>
  )
}
