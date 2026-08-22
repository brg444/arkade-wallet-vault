import { useContext, useEffect, useMemo, useState } from 'react'
import Button from '../../components/Button'
import ButtonsOnBottom from '../../components/ButtonsOnBottom'
import Content from './Content'
import ErrorMessage from '../../components/Error'
import FlexCol from '../../components/FlexCol'
import Header from './Header'
import Input from '../../components/Input'
import Padded from '../../components/Padded'
import Text from '../../components/Text'
import { useToast } from '../../components/Toast'
import { copyToClipboard } from '../../lib/clipboard'
import { broadcastTx, fetchAddressUtxos } from '../../lib/vault/esplora'
import { parseHardwareSecret } from '../../lib/vault/savingsSpend'
import { CLAIMANTS, V6_TEMPLATE, VAULT_KINDS, type Claimant, type VaultKind } from '../../lib/vault/v5/constants'
import { familyFromDescriptor } from '../../lib/vault/v5/descriptor'
import {
  assertGuardianExitSigners,
  describeGuardianExitSigners,
  finalizeGuardianExit,
  requiredGuardianExitSigners,
  signGuardianExitPsbt,
} from '../../lib/vault/v5/guardianExit'
import { inspectRecoveryKit, parseRecoveryKit } from '../../lib/vault/v5/kit'
import { planClaim, planClawback, planInitiate } from '../../lib/vault/v5/recoverFlow'
import { buildGuardianExitPsbt } from '../../lib/vault/v5/spend'
import { VaultContext } from '../../vault/context'
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
  daily: 'Legacy onchain',
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
    initiateAlert,
    initiateAlerts,
    navigate,
    operationalAddress,
    recoverEntry,
    recoverExit,
    restoreRecoveryKit,
    savingsAddress,
    signGuardianExitWithDevice,
    unlockMapWithHardware,
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
  const [wrapJson, setWrapJson] = useState('')
  const [hardwareSecret, setHardwareSecret] = useState('')
  const [cancelPsbt, setCancelPsbt] = useState('')
  const [cancelSigners, setCancelSigners] = useState<Claimant[]>([])
  const [cancelHave, setCancelHave] = useState<Claimant[]>([])
  const [cancelHardware, setCancelHardware] = useState('')
  const [cancelRecovery, setCancelRecovery] = useState('')

  const kitJson = useMemo(() => {
    try {
      return downloadRecoveryKit()
    } catch {
      return ''
    }
  }, [downloadRecoveryKit])

  const canCancelWithoutServices = useMemo(() => {
    try {
      return parseRecoveryKit(JSON.parse(downloadRecoveryKit())).descriptor.templateVersion === V6_TEMPLATE
    } catch {
      return false
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
                Start recovery with a key you still have. That begins a waiting period of a fixed number of blocks. If
                you didn’t start it, cancel it. New vaults can cancel with the remaining keys and no vault service.
                After the wait, the starter can move the coins even if those services are gone. Mutinynet blocks are
                much faster than a 10-minute chain.
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
                  detail={item === 'daily' ? 'This device, up to today’s limit' : 'This device and hardware'}
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
                    item === 'phone' ? 'This device' : item === 'hardware' ? 'The hardware key' : 'The recovery key'
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
              {psbtOut && !cancelSigners.length ? (
                <Text color='neutral-600' tiny wrap>
                  Transaction copied. Sign it with the key you still have.
                </Text>
              ) : null}
              {cancelSigners.length ? (
                <>
                  <Text wrap testId='recover-guardian-signers'>
                    Cancel without services needs {describeGuardianExitSigners(cancelSigners)}. The key that started
                    recovery cannot sign.
                  </Text>
                  {cancelSigners.map((role) => (
                    <Text key={role} color='neutral-600' tiny>
                      {KEY_LABEL[role]}
                      {cancelHave.includes(role) ? ' — signed' : ' — still needed'}
                    </Text>
                  ))}
                  {cancelSigners.includes('phone') && !cancelHave.includes('phone') ? (
                    <Button
                      label='Sign with this device'
                      testId='recover-guardian-device'
                      onClick={() => {
                        setLocalError('')
                        void (async () => {
                          try {
                            const next = await signGuardianExitWithDevice(cancelPsbt)
                            setCancelPsbt(next)
                            setCancelHave((have) => [...have, 'phone'])
                            toast('This device signed')
                          } catch (err) {
                            setLocalError(err instanceof Error ? err.message : 'Could not sign with this device')
                          }
                        })()
                      }}
                    />
                  ) : null}
                  {cancelSigners.includes('hardware') && !cancelHave.includes('hardware') ? (
                    <>
                      <Input
                        label='Hardware key'
                        placeholder='WIF or 64-char hex'
                        value={cancelHardware}
                        onChange={setCancelHardware}
                        testId='recover-guardian-hardware-secret'
                      />
                      <Button
                        secondary
                        label='Copy cancel for hardware'
                        testId='recover-guardian-hardware-copy'
                        onClick={() => {
                          void copyToClipboard(cancelPsbt)
                          toast('Cancel copied for hardware')
                        }}
                      />
                      <Button
                        label='Sign with hardware'
                        testId='recover-guardian-hardware'
                        disabled={!cancelHardware.trim()}
                        onClick={() => {
                          setLocalError('')
                          let priv: Uint8Array | undefined
                          try {
                            priv = parseHardwareSecret(cancelHardware)
                            const next = signGuardianExitPsbt(cancelPsbt, priv)
                            setCancelPsbt(next)
                            setCancelHave((have) => [...have, 'hardware'])
                            setCancelHardware('')
                            toast('Hardware signed')
                          } catch (err) {
                            setLocalError(err instanceof Error ? err.message : 'Could not sign with hardware')
                          } finally {
                            priv?.fill(0)
                          }
                        }}
                      />
                    </>
                  ) : null}
                  {cancelSigners.includes('recovery') && !cancelHave.includes('recovery') ? (
                    <>
                      <Input
                        label='Recovery key'
                        placeholder='WIF or 64-char hex'
                        value={cancelRecovery}
                        onChange={setCancelRecovery}
                        testId='recover-guardian-recovery-secret'
                      />
                      <Button
                        label='Sign with recovery'
                        testId='recover-guardian-recovery'
                        disabled={!cancelRecovery.trim()}
                        onClick={() => {
                          setLocalError('')
                          let priv: Uint8Array | undefined
                          try {
                            priv = parseHardwareSecret(cancelRecovery)
                            const next = signGuardianExitPsbt(cancelPsbt, priv)
                            setCancelPsbt(next)
                            setCancelHave((have) => [...have, 'recovery'])
                            setCancelRecovery('')
                            toast('Recovery signed')
                          } catch (err) {
                            setLocalError(err instanceof Error ? err.message : 'Could not sign with recovery')
                          } finally {
                            priv?.fill(0)
                          }
                        }}
                      />
                    </>
                  ) : null}
                  {cancelHave.length === cancelSigners.length ? (
                    <Button
                      label='Broadcast cancel'
                      testId='recover-guardian-broadcast'
                      onClick={() => {
                        setLocalError('')
                        void (async () => {
                          try {
                            const done = finalizeGuardianExit(cancelPsbt, cancelSigners.length)
                            const txid = await broadcastTx(done.txHex)
                            toast(`Cancel broadcast ${txid.slice(0, 8)}…`)
                            setCancelPsbt('')
                            setCancelSigners([])
                            setCancelHave([])
                          } catch (err) {
                            setLocalError(err instanceof Error ? err.message : 'Could not broadcast the cancel')
                          }
                        })()
                      }}
                    />
                  ) : null}
                </>
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
              {canCancelWithoutServices ? (
                <Button
                  secondary
                  label='Cancel without services'
                  testId='recover-guardian-exit'
                  disabled={!claimDest.trim()}
                  onClick={() => {
                    setLocalError('')
                    try {
                      const [k, c] = inProcess.familyKey.split('-') as [VaultKind, Claimant]
                      const kit = parseRecoveryKit(JSON.parse(downloadRecoveryKit()))
                      if (kit.descriptor.templateVersion !== V6_TEMPLATE) {
                        throw new Error('this vault cannot cancel pending recovery without the services')
                      }
                      const hasRecovery = Boolean(kit.descriptor.keys.recovery)
                      const signers = requiredGuardianExitSigners(c, hasRecovery)
                      assertGuardianExitSigners(c, signers)
                      const built = buildGuardianExitPsbt({
                        family: familyFromDescriptor(kit.descriptor),
                        kind: k,
                        claimant: c,
                        coin: { txid: inProcess.txid, vout: inProcess.vout, value: inProcess.value },
                        destAddress: claimDest.trim(),
                        feeSats: 500,
                        network: kit.descriptor.network,
                      })
                      setCancelPsbt(built.psbtHex)
                      setCancelSigners(signers)
                      setCancelHave([])
                      setPsbtOut(built.psbtHex)
                      toast(`To cancel, ${describeGuardianExitSigners(signers)} must sign.`)
                    } catch (err) {
                      setLocalError(err instanceof Error ? err.message : 'Could not cancel without services')
                    }
                  }}
                />
              ) : null}
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
              with this vault, then Face ID can rebuild it on this device or another device.
            </Text>
            <KeyCard
              title='On this device'
              role={
                hasRecoveryKit
                  ? 'The map is here. Save a file if you want a spare, or back it up with the vault.'
                  : 'No map on this device yet. Get it with Face ID, or paste a file you saved.'
              }
            />
            <KeyCard
              title='When you need the file'
              role='You can’t open this app, and you need the offline tool. Everyday send and sign-in on a new device do not use the file.'
            />
            <KeyCard
              title='When the file cannot help'
              role='If the vault services are offline, this map cannot start recovery or move coins still on the original address. This device plus hardware still can.'
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
            <Reveal label='Unlock map with hardware'>
              <Input
                label='Hardware wrap'
                placeholder='Paste the hardware wrap'
                value={wrapJson}
                onChange={setWrapJson}
                testId='hardware-map-wrap'
              />
              <Input
                label='Hardware key'
                placeholder='WIF or 64-char hex'
                value={hardwareSecret}
                onChange={setHardwareSecret}
                testId='hardware-map-secret'
              />
              <Button
                label='Unlock with hardware'
                testId='unlock-map-hardware'
                disabled={!wrapJson.trim() || !hardwareSecret.trim()}
                onClick={() => {
                  setLocalError('')
                  void (async () => {
                    try {
                      await unlockMapWithHardware(wrapJson, hardwareSecret)
                      setHardwareSecret('')
                      toast('Map unlocked with hardware')
                    } catch (err) {
                      setLocalError(err instanceof Error ? err.message : 'Could not unlock the map')
                    }
                  })()
                }}
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
                    toast(pushed ? 'Map backed up with this vault' : 'Map saved on this device')
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
                  toast('Map is on this device')
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
