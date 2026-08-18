import { useContext, useEffect, useState } from 'react'
import Button from '../../components/Button'
import ButtonsOnBottom from '../../components/ButtonsOnBottom'
import CenterScreen from '../../components/CenterScreen'
import Checkbox from '../../components/Checkbox'
import Content from '../../components/Content'
import { EmptyLogsList } from '../../components/Empty'
import FlexCol from '../../components/FlexCol'
import FlexRow from '../../components/FlexRow'
import Header from '../../components/Header'
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
import { VaultContext } from '../../providers/vault'

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
    <FlexRow
      between
      padding='0.8rem 0'
      onClick={() => {
        hapticSubtle()
        onClick()
      }}
    >
      <Text capitalize thin color={danger ? 'danger' : undefined} testId={testId}>
        {label}
      </Text>
      <FlexRow end>
        {value ? (
          <Text small thin color='neutral-500'>
            {value}
          </Text>
        ) : null}
        <ArrowIcon />
      </FlexRow>
    </FlexRow>
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
                <FlexRow
                  between
                  key={`${line.time}${line.msg}${line.level}`}
                  onClick={() => {
                    void copyToClipboard(line.msg)
                    toast('Copied to clipboard')
                  }}
                >
                  <Text color={line.level === 'error' ? 'red' : undefined}>{prettyAgo(line.time)}</Text>
                  <Text color='neutral-500'>{prettyLongText(line.msg.replace('...', ''), 12)}</Text>
                </FlexRow>
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
      <Header text='Reset' back={onBack} />
      <Content noRefresh>
        <Padded>
          <CenterScreen>
            <WalletAlternativeIcon />
            <Text>Sign out of this browser</Text>
            <TextSecondary>
              Coins stay. Sign in again with Face ID. This does not close the vault or delete the passkey.
            </TextSecondary>
          </CenterScreen>
        </Padded>
      </Content>
      <ButtonsOnBottom>
        <FlexCol gap='0.5rem'>
          <Checkbox onChange={() => setOk((value) => !value)} text='I understand' />
          <Button disabled={!ok} label='Reset' onClick={onReset} red />
        </FlexCol>
      </ButtonsOnBottom>
    </>
  )
}

export default function VaultSettings() {
  const {
    busy,
    enablePasskeyLogin,
    faucetUrl,
    hasLocalEnrollment,
    liveNetwork,
    navigate,
    operationalAddress,
    refreshBalance,
    reset,
    status,
  } = useContext(VaultContext)
  const { toast } = useToast()
  const [view, setView] = useState<View>('menu')
  const [theme, setTheme] = useState(loadVaultTheme)
  const [haptics, setHaptics] = useState(loadVaultHaptics)
  const [checkingUpdate, setCheckingUpdate] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

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
    const data = [
      ['Network', status?.network || (liveNetwork ? 'mutinynet' : 'preview')],
      ['Vault', status?.vaultId],
      ['Template', status?.templateVersion],
      ['Policy', status?.policyVersion],
      ['Site', status?.clientOrigin || location.origin],
      ['RP ID', status?.rpId],
      ['Daily limit', status ? prettyAmount(status.periodAllowance) : undefined],
      ['Per send', status ? prettyAmount(status.txCap) : undefined],
      ['App', gitCommit],
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
      <Content noRefresh>
        <Padded>
          <FlexCol gap='1.25rem'>
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
              <Row label='Sign a savings PSBT' testId='settings-hwsign' onClick={() => navigate('hwsign')} />
              <Row
                label={checkingUpdate ? 'Checking…' : 'Check for update'}
                testId='settings-update'
                onClick={() => {
                  if (checkingUpdate) return
                  setCheckingUpdate(true)
                  void reloadIfNewerWallet()
                    .then((reloaded) => {
                      if (!reloaded) toast("You're up to date")
                    })
                    .finally(() => setCheckingUpdate(false))
                }}
              />
              <Row
                label={refreshing || busy ? 'Checking…' : 'Refresh balance'}
                testId='settings-refresh'
                onClick={() => {
                  if (refreshing) return
                  setRefreshing(true)
                  void refreshBalance().finally(() => setRefreshing(false))
                }}
              />
              {liveNetwork ? (
                <Row
                  label='Faucet'
                  testId='settings-faucet'
                  onClick={() =>
                    window.open(operationalAddress ? `${faucetUrl}?address=${operationalAddress}` : faucetUrl, '_blank')
                  }
                />
              ) : null}
              <Row label='Logs' testId='settings-logs' onClick={() => setView('logs')} />
            </FlexCol>
            <FlexCol gap='0'>
              <TextLabel>Security</TextLabel>
              <Row label='Recover' testId='settings-recover' onClick={() => navigate('recover')} />
              <Row label='Recovery Kit' testId='settings-kit' onClick={() => navigate('recover')} />
              {hasLocalEnrollment && status?.enrolled && !status.passkeyLoginAvailable ? (
                <Row
                  label={busy ? 'Enabling…' : 'Allow other devices'}
                  testId='settings-devices'
                  onClick={() => void enablePasskeyLogin()}
                />
              ) : null}
              <Row label='Reset' testId='settings-reset' danger onClick={() => setView('reset')} />
            </FlexCol>
          </FlexCol>
        </Padded>
      </Content>
    </>
  )
}
