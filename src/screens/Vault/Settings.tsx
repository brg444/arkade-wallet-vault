import { useContext, useEffect, useState } from 'react'
import Checkbox from '../../components/Checkbox'
import { EmptyLogsList } from '../../components/Empty'
import Select from '../../components/Select'
import Table from '../../components/Table'
import { useToast } from '../../components/Toast'
import Toggle from '../../components/Toggle'
import ArrowIcon from '../../icons/Arrow'
import { gitCommit } from '../../_gitCommit'
import { copyToClipboard } from '../../lib/clipboard'
import { prettyAgo, prettyAmount, prettyLongText } from '../../lib/format'
import { hapticSubtle } from '../../lib/haptics'
import { clearLogs, getLogs, type LogLine } from '../../lib/logs'
import { Themes } from '../../lib/types'
import {
  loadVaultHaptics,
  loadVaultTheme,
  resolveVaultTheme,
  saveVaultHaptics,
  saveVaultTheme,
  systemTheme,
} from '../../lib/vault/prefs'
import { reloadIfNewerWallet } from '../../lib/vault/update'
import { VaultContext } from '../../vault/context'
import { useVaultReadiness } from '../../vault/useVaultReadiness'
import QgScreen, { QgPrimary } from './qg/QgScreen'

type View = 'menu' | 'theme' | 'about' | 'haptics' | 'logs' | 'reset'

function Row({
  label,
  value,
  onClick,
  danger,
  testId,
}: {
  label: string
  value?: string
  onClick: () => void
  danger?: boolean
  testId?: string
}) {
  return (
    <button
      type='button'
      className={danger ? 'vault-settings-row is-danger' : 'vault-settings-row'}
      data-testid={testId}
      onClick={() => {
        hapticSubtle()
        onClick()
      }}
    >
      <span className='vault-settings-label'>{label}</span>
      <span className='vault-settings-end'>
        {value ? <span className='vault-settings-value'>{value}</span> : null}
        <ArrowIcon />
      </span>
    </button>
  )
}

function LogsView({ onBack }: { onBack: () => void }) {
  const { toast } = useToast()
  const [logs, setLogs] = useState<LogLine[]>(() => getLogs())

  return (
    <QgScreen
      title='Logs'
      back={onBack}
      aux={<span>Clear</span>}
      auxAriaLabel='Clear'
      auxOnClick={() => {
        clearLogs()
        setLogs([])
      }}
    >
      {logs.length === 0 ? (
        <EmptyLogsList />
      ) : (
        <div className='qg-methods'>
          {[...logs].reverse().map((line) => (
            <button
              type='button'
              className='vault-settings-row'
              key={`${line.time}${line.msg}${line.level}`}
              onClick={() => {
                void copyToClipboard(line.msg)
                toast('Copied to clipboard')
              }}
            >
              <span>
                <strong className={line.level === 'error' ? 'vault-log-time is-error' : 'vault-log-time'}>
                  {Date.now() - new Date(line.time).getTime() < 60_000 ? 'Just now' : prettyAgo(line.time)}
                </strong>
                <small>{prettyLongText(line.msg.replace('...', ''), 12)}</small>
              </span>
            </button>
          ))}
        </div>
      )}
    </QgScreen>
  )
}

function ResetView({ onBack, onReset }: { onBack: () => void; onReset: () => void }) {
  const [ok, setOk] = useState(false)
  return (
    <QgScreen title='Sign out' back={onBack} footer={<QgPrimary onClick={onReset} disabled={!ok} label='Sign out' />}>
      <p className='qg-eyebrow'>This browser</p>
      <h1>Sign out of this browser</h1>
      <p className='qg-copy'>
        Coins stay on the vault. Sign in again with your passkey. This does not close the vault or delete the passkey.
      </p>
      <div className='qg-consent'>
        <Checkbox onChange={() => setOk((value) => !value)} text='I understand' />
      </div>
    </QgScreen>
  )
}

export default function VaultSettings() {
  const { balanceError, busy, liveNetwork, refreshBalance, refreshingBalance, reset, setup, status } =
    useContext(VaultContext)
  const readiness = useVaultReadiness()
  const { toast } = useToast()
  const [view, setView] = useState<View>('menu')
  const [theme, setTheme] = useState(loadVaultTheme)
  const [haptics, setHaptics] = useState(loadVaultHaptics)
  const [checkingUpdate, setCheckingUpdate] = useState(false)

  useEffect(() => {
    if (view !== 'menu') return
    setTheme(loadVaultTheme())
    setHaptics(loadVaultHaptics())
  }, [view])

  if (view === 'theme') {
    return (
      <QgScreen title='Theme' back={() => setView('menu')}>
        <Select
          accessibleName='Theme'
          labels={[`Auto (${systemTheme()})`, 'Dark', 'Light']}
          options={[Themes.Auto, Themes.Dark, Themes.Light]}
          selected={theme}
          onChange={(value) => {
            const next = value as Themes
            setTheme(next)
            saveVaultTheme(next)
          }}
        />
      </QgScreen>
    )
  }

  if (view === 'haptics') {
    return (
      <QgScreen title='Haptics' back={() => setView('menu')}>
        <Toggle
          checked={haptics}
          onClick={() => {
            const next = !haptics
            setHaptics(next)
            saveVaultHaptics(next)
          }}
          text='Haptic feedback'
          subtext='Vibration on taps'
        />
      </QgScreen>
    )
  }

  if (view === 'about') {
    const tier = status?.protectionTier || setup.protectionTier
    const readinessLabel =
      readiness.state === 'checking'
        ? 'Checking…'
        : readiness.state === 'ready'
          ? 'Ready'
          : readiness.state === 'unavailable'
            ? 'Unavailable'
            : 'Can’t reach'
    const data = [
      ['Network', status?.network === 'mutinynet' || liveNetwork ? 'Mutinynet' : 'Unavailable'],
      ['App revision', gitCommit],
      ['Vault', status?.vaultId],
      ['Enrolled template', status?.templateVersion],
      ['Policy version', status?.policyVersion],
      [
        'Protection tier',
        tier === 'advanced' ? 'Advanced — separate recovery key' : 'Standard — no separate recovery key',
      ],
      ['Per-payment limit', prettyAmount(status?.txCap || setup.txCapSats)],
      ['Rolling allowance', prettyAmount(status?.periodAllowance || setup.dailyLimitSats)],
      ['Vault service', readinessLabel],
      ['Site', status?.clientOrigin || location.origin],
      ['RP ID', status?.rpId],
    ] as [string, string | undefined][]
    return (
      <QgScreen title='About' back={() => setView('menu')}>
        <div className='vault-about-table'>
          <Table data={data} />
        </div>
      </QgScreen>
    )
  }

  if (view === 'logs') return <LogsView onBack={() => setView('menu')} />
  if (view === 'reset') return <ResetView onBack={() => setView('menu')} onReset={reset} />

  return (
    <QgScreen title='Settings'>
      <p className='qg-eyebrow'>General</p>
      <div className='qg-methods'>
        <Row
          label='Theme'
          testId='settings-theme'
          value={theme === Themes.Auto ? `Auto (${resolveVaultTheme(Themes.Auto)})` : theme}
          onClick={() => setView('theme')}
        />
        <Row
          label='Haptics'
          testId='settings-haptics'
          value={haptics ? 'On' : 'Off'}
          onClick={() => setView('haptics')}
        />
        <Row label='About' testId='settings-about' onClick={() => setView('about')} />
      </div>
      <p className='qg-eyebrow'>Advanced</p>
      <div className='qg-methods'>
        <Row
          label={checkingUpdate ? 'Checking…' : 'Check for update'}
          testId='settings-update'
          onClick={() => {
            if (checkingUpdate) return
            setCheckingUpdate(true)
            void reloadIfNewerWallet()
              .then((reloaded) => {
                if (!reloaded) toast('You’re up to date')
              })
              .finally(() => setCheckingUpdate(false))
          }}
        />
        <Row
          label={refreshingBalance || busy ? 'Checking…' : 'Refresh balance'}
          testId='settings-refresh'
          value={balanceError ? 'Failed' : undefined}
          onClick={() => {
            if (refreshingBalance) return
            void refreshBalance()
          }}
        />
        <Row label='Logs' testId='settings-logs' onClick={() => setView('logs')} />
      </div>
      <p className='qg-eyebrow'>This browser</p>
      <div className='qg-methods'>
        <Row label='Sign out' testId='settings-signout' danger onClick={() => setView('reset')} />
      </div>
    </QgScreen>
  )
}
