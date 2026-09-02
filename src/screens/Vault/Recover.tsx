import { useContext, useEffect, useMemo, useState } from 'react'
import { hex } from '@scure/base'
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
import { prettyAmount } from '../../lib/format'
import { broadcastTx, fetchAddressUtxos } from '../../lib/vault/esplora'
import { parseIncomingPsbt, psbtFile } from '../../lib/vault/savingsSpend'
import { CLAIMANTS, SAVINGS_TEMPLATE, type Claimant } from '../../lib/vault/program/constants'
import { familyFromDescriptor } from '../../lib/vault/program/descriptor'
import {
  acceptGuardianExitSignature,
  assertGuardianExitSigners,
  describeGuardianExitSigners,
  finalizeGuardianExit,
  requiredGuardianExitSigners,
} from '../../lib/vault/program/guardianExit'
import { inspectRecoveryKit, parseRecoveryKit } from '../../lib/vault/program/kit'
import { planClaim, planClawback, planInitiate } from '../../lib/vault/program/recoverFlow'
import { buildGuardianExitPsbt } from '../../lib/vault/program/spend'
import { findMatureBoardingInputs } from '../../lib/vault/vtxo/boardingRecovery'
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

function downloadPsbt(name: string, psbtHex: string) {
  const hidden = document.createElement('a')
  hidden.href = URL.createObjectURL(psbtFile(psbtHex, name))
  hidden.download = name
  document.body.appendChild(hidden)
  hidden.click()
  hidden.remove()
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
    recoverEntry,
    recoverExit,
    recoverMatureBoarding,
    restoreRecoveryKit,
    savingsAddress,
    signGuardianExitWithDevice,
    status,
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
  const [claimant, setClaimant] = useState<Claimant>('hardware')
  const [claimDest, setClaimDest] = useState('')
  const [psbtOut, setPsbtOut] = useState('')
  const [cancelPsbt, setCancelPsbt] = useState('')
  const [cancelSigners, setCancelSigners] = useState<Claimant[]>([])
  const [cancelHave, setCancelHave] = useState<Claimant[]>([])
  const [signedCancelPsbt, setSignedCancelPsbt] = useState('')
  const [matureBoardingSats, setMatureBoardingSats] = useState(0)
  const [confirmBoardingRecovery, setConfirmBoardingRecovery] = useState(false)
  const [recoveringBoarding, setRecoveringBoarding] = useState(false)

  useEffect(() => {
    let active = true
    setMatureBoardingSats(0)
    setConfirmBoardingRecovery(false)
    if (view !== 'kit' || !status?.enrolled) return () => undefined
    void findMatureBoardingInputs(status)
      .then(({ totalSats }) => {
        if (active) setMatureBoardingSats(totalSats)
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [status, view])

  const kitJson = useMemo(() => {
    try {
      return downloadRecoveryKit()
    } catch {
      return ''
    }
  }, [downloadRecoveryKit])

  const canCancelWithoutServices = useMemo(() => {
    try {
      return parseRecoveryKit(JSON.parse(downloadRecoveryKit())).descriptor.templateVersion === SAVINGS_TEMPLATE
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
    const externalRole = cancelSigners.find((role) => role !== 'phone' && !cancelHave.includes(role))
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
                <KeyCard title='Recovery in process' role={initiateAlert || 'Savings waiting'} status='Alert' />
              ) : null}
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
                  {externalRole ? (
                    <>
                      <Button
                        secondary
                        label={`Download cancel for ${KEY_LABEL[externalRole]}`}
                        testId='recover-guardian-external-download'
                        onClick={() => {
                          downloadPsbt('arkade-cancel.psbt', cancelPsbt)
                          toast(`Cancel PSBT saved for ${KEY_LABEL[externalRole]}`)
                        }}
                      />
                      <label>
                        <Text color='neutral-600' tiny>
                          Signed cancel PSBT file
                        </Text>
                        <input
                          type='file'
                          accept='.psbt,application/octet-stream'
                          data-testid='recover-guardian-signed-file'
                          onChange={(event) => {
                            const file = event.target.files?.[0]
                            if (!file) return
                            void file
                              .arrayBuffer()
                              .then((body) => setSignedCancelPsbt(hex.encode(new Uint8Array(body))))
                          }}
                        />
                      </label>
                      <Input
                        label={`Signed by ${KEY_LABEL[externalRole]}`}
                        placeholder='Paste a signed PSBT, or choose the file'
                        value={signedCancelPsbt}
                        onChange={setSignedCancelPsbt}
                        testId='recover-guardian-signed-psbt'
                      />
                      <Button
                        label={`Accept ${KEY_LABEL[externalRole]} signature`}
                        testId='recover-guardian-external'
                        disabled={!signedCancelPsbt.trim()}
                        onClick={() => {
                          setLocalError('')
                          try {
                            const kit = parseRecoveryKit(JSON.parse(downloadRecoveryKit()))
                            const expectedPub =
                              externalRole === 'hardware' ? kit.descriptor.keys.hardware : kit.descriptor.keys.recovery
                            if (!expectedPub) throw new Error(`${KEY_LABEL[externalRole]} is not configured`)
                            const next = acceptGuardianExitSignature(
                              cancelPsbt,
                              parseIncomingPsbt(signedCancelPsbt),
                              expectedPub,
                            )
                            setCancelPsbt(next)
                            setCancelHave((have) => [...have, externalRole])
                            setSignedCancelPsbt('')
                            toast(`${KEY_LABEL[externalRole]} signature accepted`)
                          } catch (err) {
                            setLocalError(err instanceof Error ? err.message : 'Could not accept the signed PSBT')
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
                            setSignedCancelPsbt('')
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
                    const [, c] = inProcess.familyKey.split('-') as ['savings', Claimant]
                    const kit = parseRecoveryKit(JSON.parse(downloadRecoveryKit()))
                    const built = planClawback({
                      family: familyFromDescriptor(kit.descriptor),
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
                      const [, c] = inProcess.familyKey.split('-') as ['savings', Claimant]
                      const kit = parseRecoveryKit(JSON.parse(downloadRecoveryKit()))
                      if (kit.descriptor.templateVersion !== SAVINGS_TEMPLATE) {
                        throw new Error('this vault cannot cancel pending recovery without the services')
                      }
                      const hasRecovery = Boolean(kit.descriptor.keys.recovery)
                      const signers = requiredGuardianExitSigners(c, hasRecovery)
                      assertGuardianExitSigners(c, signers)
                      const built = buildGuardianExitPsbt({
                        family: familyFromDescriptor(kit.descriptor),
                        claimant: c,
                        coin: { txid: inProcess.txid, vout: inProcess.vout, value: inProcess.value },
                        destAddress: claimDest.trim(),
                        feeSats: 500,
                        network: kit.descriptor.network,
                      })
                      setCancelPsbt(built.psbtHex)
                      setCancelSigners(signers)
                      setCancelHave([])
                      setSignedCancelPsbt('')
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
                    const [, c] = inProcess.familyKey.split('-') as ['savings', Claimant]
                    const kit = parseRecoveryKit(JSON.parse(downloadRecoveryKit()))
                    const built = planClaim({
                      family: familyFromDescriptor(kit.descriptor),
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
                    if (!savingsAddress) throw new Error('No Savings address yet')
                    const coin = (await fetchAddressUtxos(savingsAddress)).find(
                      (item) => item.status.confirmed && item.value > 1000,
                    )
                    if (!coin) throw new Error('No confirmed coin on that account')
                    const built = planInitiate({
                      family,
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
              with this vault, then device unlock can rebuild it on this device or another device.
            </Text>
            <KeyCard
              title='On this device'
              role={
                hasRecoveryKit
                  ? 'The map is here. Save a file if you want a spare, or back it up with the vault.'
                  : 'No map on this device yet. Get it with device unlock, or paste a file you saved.'
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
            <KeyCard
              title='I lost a key'
              role='Start a waiting period. Cancel if it wasn’t you.'
              onClick={() => {
                setLocalError('')
                setFromKit(true)
                setView('lost')
              }}
            />
            {matureBoardingSats > 0 ? (
              <>
                <KeyCard
                  title='Recover received Bitcoin'
                  role='These funds have waited long enough to return onchain with this device.'
                  amount={prettyAmount(matureBoardingSats)}
                  testId='recover-mature-boarding'
                  onClick={() => setConfirmBoardingRecovery(true)}
                />
                {confirmBoardingRecovery ? (
                  <>
                    <Text wrap>
                      Device unlock will authorize a one-time recovery to this device. A network fee is deducted before
                      the transaction is sent.
                    </Text>
                    <Button
                      label={recoveringBoarding ? 'Recovering…' : 'Recover to this device'}
                      testId='recover-mature-boarding-confirm'
                      disabled={recoveringBoarding}
                      onClick={() => {
                        if (recoveringBoarding) return
                        setRecoveringBoarding(true)
                        setLocalError('')
                        void recoverMatureBoarding()
                          .then((txid) => {
                            setMatureBoardingSats(0)
                            setConfirmBoardingRecovery(false)
                            toast(`Recovery sent ${txid.slice(0, 8)}…`)
                          })
                          .catch((err) => {
                            setLocalError(err instanceof Error ? err.message : 'Could not recover received Bitcoin')
                          })
                          .finally(() => setRecoveringBoarding(false))
                      }}
                    />
                  </>
                ) : null}
              </>
            ) : null}
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
              label={busy ? 'Waiting for device unlock…' : 'Back up map'}
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
            label={busy ? 'Waiting for device unlock…' : 'Get map'}
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
