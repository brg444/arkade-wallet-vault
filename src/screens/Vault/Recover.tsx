import { useContext, useEffect, useMemo, useState } from 'react'
import Button from '../../components/Button'
import ButtonsOnBottom from '../../components/ButtonsOnBottom'
import Content from '../../components/Content'
import ErrorMessage from '../../components/Error'
import FlexCol from '../../components/FlexCol'
import Header from '../../components/Header'
import Input from '../../components/Input'
import Padded from '../../components/Padded'
import Text from '../../components/Text'
import { useToast } from '../../components/Toast'
import { copyToClipboard } from '../../lib/clipboard'
import { canBrowserShareData, shareData } from '../../lib/share'
import { fetchAddressUtxos } from '../../lib/vault/esplora'
import { CLAIMANTS, VAULT_KINDS, type Claimant, type VaultKind } from '../../lib/vault/v5/constants'
import { familyFromDescriptor } from '../../lib/vault/v5/descriptor'
import { inspectRecoveryKit, parseRecoveryKit } from '../../lib/vault/v5/kit'
import { planClaim, planClawback, planInitiate } from '../../lib/vault/v5/recoverFlow'
import { VaultContext } from '../../providers/vault'
import { KeyCard, Reveal } from './ui'
import { ChoiceCard } from './onboard/Layout'

function downloadJson(name: string, body: string) {
  const hidden = document.createElement('a')
  hidden.href = URL.createObjectURL(new Blob([body], { type: 'application/json' }))
  hidden.download = name
  document.body.appendChild(hidden)
  hidden.click()
  hidden.remove()
}

const ACCOUNT_LABEL: Record<VaultKind, string> = {
  daily: 'Spending',
  savings: 'Savings',
}

const KEY_LABEL: Record<Claimant, string> = {
  phone: 'This device',
  hardware: 'Hardware',
  recovery: 'Recovery',
}

export default function VaultRecover() {
  const {
    backupRecoveryKit,
    busy,
    downloadRecoveryKit,
    error,
    hasRecoveryKit,
    initiateAlerts,
    navigate,
    operationalAddress,
    recoverEntry,
    recoverExit,
    restoreRecoveryKit,
    savingsAddress,
  } = useContext(VaultContext)
  const { toast } = useToast()
  const [view, setView] = useState<'kit' | 'lost'>(recoverEntry)
  const [fromKit, setFromKit] = useState(false)

  useEffect(() => {
    setView(recoverEntry)
    setFromKit(false)
  }, [recoverEntry])
  const [pasted, setPasted] = useState('')
  const [localError, setLocalError] = useState('')
  const [kind, setKind] = useState<VaultKind>('daily')
  const [claimant, setClaimant] = useState<Claimant>('hardware')
  const [claimDest, setClaimDest] = useState('')
  const [psbtOut, setPsbtOut] = useState('')

  const kitJson = useMemo(() => {
    try {
      return downloadRecoveryKit()
    } catch {
      return ''
    }
  }, [downloadRecoveryKit])

  const report = useMemo(() => {
    const raw = pasted.trim() || kitJson
    if (!raw) return null
    try {
      return inspectRecoveryKit(parseRecoveryKit(JSON.parse(raw)))
    } catch (err) {
      return { error: err instanceof Error ? err.message : 'That file is not a Recovery Kit' }
    }
  }, [kitJson, pasted])

  const saveKit = () => {
    setLocalError('')
    try {
      downloadJson('arkade-recovery-kit.json', downloadRecoveryKit())
      toast('Recovery Kit saved')
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'No Recovery Kit yet')
    }
  }

  const shareKit = () => {
    setLocalError('')
    try {
      const body = downloadRecoveryKit()
      void (async () => {
        if (canBrowserShareData({ text: body, title: 'Recovery Kit' })) {
          await shareData({ text: body, title: 'Recovery Kit' })
          return
        }
        await copyToClipboard(body)
        toast('Recovery Kit copied')
      })()
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'No Recovery Kit yet')
    }
  }

  if (view === 'lost') {
    const inProcess = initiateAlerts[0]
    return (
      <>
        <Header
          text='Lost a key'
          back={() => (fromKit || recoverEntry === 'kit' ? setView('kit') : navigate(recoverExit))}
        />
        <Content noRefresh>
          <Padded>
            <FlexCol>
              <Text wrap>
                Start recovery with a key you still have. That begins a waiting period. If you didn’t start it, cancel
                it. After the wait, move the coins.
              </Text>
              {inProcess ? (
                <KeyCard
                  title='Recovery in process'
                  role={initiateAlert || `${ACCOUNT_LABEL[inProcess.familyKey.split('-')[0] as VaultKind]} waiting`}
                  status='Alert'
                />
              ) : null}
              <Text color='neutral-600' tiny>
                Which account
              </Text>
              {VAULT_KINDS.map((item) => (
                <ChoiceCard
                  key={item}
                  title={ACCOUNT_LABEL[item]}
                  detail={item === 'daily' ? 'This phone, up to today’s limit' : 'This phone and hardware'}
                  selected={kind === item}
                  onClick={() => setKind(item)}
                  testId={`recover-kind-${item}`}
                />
              ))}
              <Text color='neutral-600' tiny>
                Which key is gone
              </Text>
              {CLAIMANTS.map((item) => (
                <ChoiceCard
                  key={item}
                  title={KEY_LABEL[item]}
                  detail={
                    item === 'phone' ? 'This phone' : item === 'hardware' ? 'The hardware key' : 'The recovery key'
                  }
                  selected={claimant === item}
                  onClick={() => setClaimant(item)}
                  testId={`recover-key-${item}`}
                />
              ))}
              {inProcess ? (
                <Input
                  label='After the wait, send coins here'
                  placeholder='tb1p…'
                  value={claimDest}
                  onChange={setClaimDest}
                  testId='recover-claim-dest'
                />
              ) : null}
              {psbtOut ? (
                <Text color='neutral-600' tiny wrap>
                  Transaction copied. Sign it with the key you still have.
                </Text>
              ) : null}
              <ErrorMessage error={Boolean(error || localError)} text={error || localError} />
            </FlexCol>
          </Padded>
        </Content>
        <ButtonsOnBottom>
          {inProcess ? (
            <>
              <Button
                label='Cancel recovery'
                testId='recover-clawback'
                onClick={() => {
                  setLocalError('')
                  try {
                    const [k, c] = inProcess.familyKey.split('-') as [VaultKind, Claimant]
                    const kit = parseRecoveryKit(JSON.parse(downloadRecoveryKit()))
                    const built = planClawback({
                      family: familyFromDescriptor(kit.descriptor),
                      kind: k,
                      claimant: c,
                      coin: { txid: inProcess.txid, vout: inProcess.vout, value: inProcess.value },
                      feeSats: 500,
                      vaultId: kit.descriptor.vaultId,
                    })
                    setPsbtOut(built.psbtHex)
                    void copyToClipboard(built.psbtHex)
                    toast('Cancel copied. This leaves out the key that started recovery.')
                  } catch (err) {
                    setLocalError(err instanceof Error ? err.message : 'Could not cancel recovery')
                  }
                }}
              />
              <Button
                secondary
                label='Move coins'
                testId='recover-claim'
                disabled={!claimDest.trim()}
                onClick={() => {
                  setLocalError('')
                  try {
                    const [k, c] = inProcess.familyKey.split('-') as [VaultKind, Claimant]
                    const kit = parseRecoveryKit(JSON.parse(downloadRecoveryKit()))
                    const built = planClaim({
                      family: familyFromDescriptor(kit.descriptor),
                      kind: k,
                      claimant: c,
                      coin: { txid: inProcess.txid, vout: inProcess.vout, value: inProcess.value },
                      destAddress: claimDest.trim(),
                      feeSats: 500,
                      network: kit.descriptor.network,
                    })
                    setPsbtOut(built.psbtHex)
                    void copyToClipboard(built.psbtHex)
                    toast('Move copied. Only after the wait.')
                  } catch (err) {
                    setLocalError(err instanceof Error ? err.message : 'Could not move coins')
                  }
                }}
              />
            </>
          ) : (
            <Button
              label='Start recovery'
              testId='recover-initiate'
              onClick={() => {
                setLocalError('')
                void (async () => {
                  try {
                    const kit = parseRecoveryKit(JSON.parse(downloadRecoveryKit()))
                    const family = familyFromDescriptor(kit.descriptor)
                    const source = kind === 'daily' ? operationalAddress : savingsAddress
                    if (!source) throw new Error('No coins on that account yet')
                    const coin = (await fetchAddressUtxos(source)).find(
                      (item) => item.status.confirmed && item.value > 1000,
                    )
                    if (!coin) throw new Error('No confirmed coin on that account')
                    const built = planInitiate({
                      family,
                      kind,
                      claimant,
                      coin: { txid: coin.txid, vout: coin.vout, value: coin.value },
                      feeSats: 500,
                      vaultId: kit.descriptor.vaultId,
                    })
                    setPsbtOut(built.psbtHex)
                    await copyToClipboard(built.psbtHex)
                    toast('Recovery started. A waiting period begins once this confirms.')
                  } catch (err) {
                    setLocalError(err instanceof Error ? err.message : 'Could not start recovery')
                  }
                })()
              }}
            />
          )}
        </ButtonsOnBottom>
      </>
    )
  }

  return (
    <>
      <Header text='Recovery Kit' back={() => navigate(recoverExit)} />
      <Content noRefresh>
        <Padded>
          <FlexCol>
            <Text wrap>
              The Recovery Kit is a map of this vault. It is not a seed. It does not hold your keys. Back up the map
              with this vault, then Face ID can rebuild it on this phone or another phone.
            </Text>
            <KeyCard
              title='On this phone'
              role={
                hasRecoveryKit
                  ? 'The map is here. Save a file if you want a spare, or back it up with the vault.'
                  : 'No map on this phone yet. Get it with Face ID, or paste a file you saved.'
              }
            />
            <KeyCard
              title='When you need the file'
              role='You can’t open this app, and you need the offline tool. Everyday send and sign-in on a new phone do not use the file.'
            />
            <KeyCard
              title='When the file cannot help'
              role='If the vault services are offline, this map cannot start recovery or move coins still on the original address. This phone plus hardware still can.'
            />
            {report && 'trees' in report ? (
              <Text color='neutral-600' tiny wrap>
                This kit is for vault {report.vaultId.slice(0, 8)}… · {report.trees.length} addresses
              </Text>
            ) : null}
            {report && 'error' in report && pasted.trim() ? <ErrorMessage error text={report.error} /> : null}
            <Reveal label='I already have a kit file'>
              <Input
                label='Recovery Kit'
                placeholder='Paste the file to check it'
                value={pasted}
                onChange={setPasted}
                testId='recovery-kit-json'
              />
            </Reveal>
            <KeyCard
              title='I lost a key'
              role='Start a waiting period. Cancel if it wasn’t you.'
              onClick={() => {
                setLocalError('')
                setFromKit(true)
                setView('lost')
              }}
            />
            <ErrorMessage error={Boolean(error || localError)} text={error || localError} />
          </FlexCol>
        </Padded>
      </Content>
      <ButtonsOnBottom>
        {hasRecoveryKit ? (
          <>
            <Button label='Save Recovery Kit' testId='download-recovery-kit' onClick={saveKit} />
            <Button
              secondary
              label={busy ? 'Waiting for Face ID…' : 'Back up map'}
              testId='backup-recovery-kit'
              disabled={busy}
              onClick={() => {
                setLocalError('')
                void (async () => {
                  try {
                    const pushed = await backupRecoveryKit()
                    toast(pushed ? 'Map backed up with this vault' : 'Map saved on this phone')
                  } catch (err) {
                    setLocalError(err instanceof Error ? err.message : 'Could not back up the map')
                  }
                })()
              }}
            />
          </>
        ) : (
          <Button
            label={busy ? 'Waiting for Face ID…' : 'Get map'}
            testId='restore-recovery-kit'
            disabled={busy}
            onClick={() => {
              setLocalError('')
              void (async () => {
                try {
                  await restoreRecoveryKit()
                  toast('Map is on this phone')
                } catch (err) {
                  setLocalError(err instanceof Error ? err.message : 'Could not get the map')
                }
              })()
            }}
          />
        )}
      </ButtonsOnBottom>
    </>
  )
}
