import { useContext, useEffect, useState } from 'react'
import Button from '../../components/Button'
import ButtonsOnBottom from '../../components/ButtonsOnBottom'
import CenterScreen from '../../components/CenterScreen'
import Checkbox from '../../components/Checkbox'
import Content from './Content'
import { EmptyLogsList } from '../../components/Empty'
import FlexCol from '../../components/FlexCol'
import Header from './Header'
import Padded from '../../components/Padded'
import Select from '../../components/Select'
import Table from '../../components/Table'
import Text, { TextLabel, TextSecondary } from '../../components/Text'
import { useToast } from '../../components/Toast'
import Toggle from '../../components/Toggle'
import ArrowIcon from '../../icons/Arrow'
import { WalletAlternativeIcon } from '../../icons/Wallet'
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
    <>
      <Header
        text='Logs'
        back={onBack}
        auxText='Clear'
        auxFunc={() => {
          clearLogs()
          setLogs([])
        }}
      />
      <Content noRefresh>
        {logs.length === 0 ? (
          <EmptyLogsList />
        ) : (
          <div style={{ margin: '1rem' }} className='scroll-fade'>
            <FlexCol gap='0.5rem'>
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
                  <span className={line.level === 'error' ? 'vault-log-time is-error' : 'vault-log-time'}>
                    {prettyAgo(line.time)}
                  </span>
                  <span className='vault-settings-value'>{prettyLongText(line.msg.replace('...', ''), 12)}</span>
                </button>
              ))}
            </FlexCol>
          </div>
        )}
      </Content>
    </>
  )
}

function ResetView({ onBack, onReset }: { onBack: () => void; onReset: () => void }) {
  const [ok, setOk] = useState(false)
  return (
    <>
      <Header text='Sign out' back={onBack} />
      <Content noRefresh>
        <Padded>
          <CenterScreen>
            <WalletAlternativeIcon />
            <Text>Sign out of this browser</Text>
            <TextSecondary>
              Coins stay on the vault. Sign in again with device unlock. This does not close the vault or delete the
              passkey.
            </TextSecondary>
          </CenterScreen>
        </Padded>
      </Content>
      <ButtonsOnBottom>
        <FlexCol gap='0.75rem'>
          <Checkbox onChange={() => setOk((value) => !value)} text='I understand' />
          <Button disabled={!ok} label='Sign out' onClick={onReset} red />
        </FlexCol>
      </ButtonsOnBottom>
    </>
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
      <>
        <Header text='Theme' back={() => setView('menu')} />
        <Content noRefresh>
          <Padded>
            <Select
              labels={[`Auto (${systemTheme()})`, 'Dark', 'Light']}
              options={[Themes.Auto, Themes.Dark, Themes.Light]}
              selected={theme}
              onChange={(value) => {
                const next = value as Themes
                setTheme(next)
                saveVaultTheme(next)
              }}
            />
          </Padded>
        </Content>
      </>
    )
  }

  if (view === 'haptics') {
    return (
      <>
        <Header text='Haptics' back={() => setView('menu')} />
        <Content noRefresh>
          <Padded>
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
          </Padded>
        </Content>
      </>
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
      <>
        <Header text='About' back={() => setView('menu')} />
        <Content noRefresh>
          <Padded>
            <Table data={data} />
          </Padded>
        </Content>
      </>
    )
  }

  if (view === 'logs') return <LogsView onBack={() => setView('menu')} />
  if (view === 'reset') return <ResetView onBack={() => setView('menu')} onReset={reset} />

  return (
    <>
      <Header text='Settings' />
      <Content noRefresh className='vault-settings-content'>
        <Padded>
          <FlexCol gap='1.25rem' className='vault-settings-menu'>
            <FlexCol gap='0'>
              <TextLabel>General</TextLabel>
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
            </FlexCol>
            <FlexCol gap='0'>
              <TextLabel>Advanced</TextLabel>
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
            </FlexCol>
            <FlexCol gap='0'>
              <TextLabel>This browser</TextLabel>
              <Row label='Sign out' testId='settings-signout' danger onClick={() => setView('reset')} />
            </FlexCol>
          </FlexCol>
        </Padded>
      </Content>
    </>
  )
}
