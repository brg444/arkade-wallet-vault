import { useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { hex } from '@scure/base'
import FingerprintIcon from '../../icons/Fingerprint'
import SafeIcon from '../../icons/Safe'
import ShieldCheckOutlineIcon from '../../icons/ShieldCheckOutline'
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
import { HubGroup, HubRow } from './ui'
import QgScreen, { QgCheck, QgPrimary, QgSecondary } from './qg/QgScreen'

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

const KEY_DETAIL: Record<Claimant, string> = {
  phone: 'Use the passkey on this device',
  hardware: 'Use your hardware key',
  recovery: 'Use your separately stored recovery key',
}

const KEY_ICON: Record<Claimant, ReactNode> = {
  phone: <FingerprintIcon />,
  hardware: <ShieldCheckOutlineIcon />,
  recovery: <SafeIcon />,
}

function RecoverAlert({ text }: { text: string }) {
  if (!text) return null
  return (
    <p className='qg-copy' role='alert'>
      {text}
    </p>
  )
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
  const [showPaste, setShowPaste] = useState(false)
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
      downloadJson('Recovery Kit.json', downloadRecoveryKit())
      toast('Recovery Kit saved')
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'No Recovery Kit yet')
    }
  }

  if (view === 'lost') {
    const inProcess = initiateAlerts[0]
    const externalRole = cancelSigners.find((role) => role !== 'phone' && !cancelHave.includes(role))
    const backToKit = fromKit || recoverEntry === 'kit'
    const fromHome = recoverExit === 'home'
    return (
      <QgScreen
        title={fromHome && !backToKit ? 'Recovery' : 'Lost a key'}
        dismiss={!backToKit && fromHome ? () => navigate('home') : undefined}
        back={backToKit ? () => setView('kit') : fromHome ? undefined : () => navigate(recoverExit)}
        footer={
          inProcess ? (
            <>
              <RecoverAlert text={error || localError} />
              <QgPrimary
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
                <QgSecondary
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
              <QgSecondary
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
            <>
              <RecoverAlert text={error || localError} />
              <QgPrimary
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
            </>
          )
        }
      >
        <div className='vault-security'>
          <section className='vault-security-hero' aria-label='Recovery status'>
            <div className='vault-security-hero-head'>
              <strong>Recovery protection</strong>
              <span className={inProcess ? 'is-attention' : 'is-ready'}>{inProcess ? 'In process' : 'Idle'}</span>
            </div>
            <h2>{inProcess ? 'Recovery is waiting.' : 'Recover with a key you still control.'}</h2>
            <p>
              {inProcess
                ? initiateAlert || 'Savings is in a waiting period. Cancel if you didn’t start this.'
                : 'Starting recovery creates a visible waiting period. Your other keys can cancel it if the request was not yours.'}
            </p>
          </section>

          <div className='vault-section'>
            <p className='vault-section-label'>Recover with</p>
            <div className='vault-hub' role='radiogroup' aria-label='Key to use for recovery'>
              {CLAIMANTS.map((item) => (
                <button
                  key={item}
                  type='button'
                  role='radio'
                  aria-checked={claimant === item}
                  className={claimant === item ? 'vault-hub-row is-on' : 'vault-hub-row'}
                  data-testid={`recover-key-${item}`}
                  onClick={() => setClaimant(item)}
                >
                  <div className='vault-icon sm' aria-hidden>
                    {KEY_ICON[item]}
                  </div>
                  <div className='vault-hub-copy'>
                    <p>{KEY_LABEL[item]}</p>
                    <p>{KEY_DETAIL[item]}</p>
                  </div>
                  {claimant === item ? (
                    <span className='qg-account-option-check' aria-hidden>
                      <QgCheck />
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
          </div>
          {inProcess ? (
            <label className='qg-field'>
              <span>After the wait, send coins here</span>
              <input
                value={claimDest}
                placeholder='tb1p…'
                data-testid='recover-claim-dest'
                onChange={(event) => setClaimDest(event.target.value)}
              />
            </label>
          ) : null}
          {psbtOut && !cancelSigners.length ? (
            <p className='qg-copy'>Transaction copied. Sign it with the key you still have.</p>
          ) : null}
          {cancelSigners.length ? (
            <>
              <p className='qg-copy' data-testid='recover-guardian-signers'>
                Cancel without services needs {describeGuardianExitSigners(cancelSigners)}. The key that started
                recovery cannot sign.
              </p>
              <section className='qg-summary'>
                {cancelSigners.map((role) => (
                  <div key={role}>
                    <span>{KEY_LABEL[role]}</span>
                    <strong>{cancelHave.includes(role) ? 'signed' : 'still needed'}</strong>
                  </div>
                ))}
              </section>
              {cancelSigners.includes('phone') && !cancelHave.includes('phone') ? (
                <QgPrimary
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
                  <QgSecondary
                    label={`Download cancel for ${KEY_LABEL[externalRole]}`}
                    testId='recover-guardian-external-download'
                    onClick={() => {
                      downloadPsbt('arkade-cancel.psbt', cancelPsbt)
                      toast(`Cancel PSBT saved for ${KEY_LABEL[externalRole]}`)
                    }}
                  />
                  <label className='qg-field'>
                    <span>Signed cancel PSBT file</span>
                    <input
                      type='file'
                      accept='.psbt,application/octet-stream'
                      data-testid='recover-guardian-signed-file'
                      onChange={(event) => {
                        const file = event.target.files?.[0]
                        if (!file) return
                        void file.arrayBuffer().then((body) => setSignedCancelPsbt(hex.encode(new Uint8Array(body))))
                      }}
                    />
                  </label>
                  <label className='qg-field'>
                    <span>{`Signed by ${KEY_LABEL[externalRole]}`}</span>
                    <input
                      value={signedCancelPsbt}
                      placeholder='Paste a signed PSBT, or choose the file'
                      data-testid='recover-guardian-signed-psbt'
                      onChange={(event) => setSignedCancelPsbt(event.target.value)}
                    />
                  </label>
                  <QgPrimary
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
                <QgPrimary
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
        </div>
      </QgScreen>
    )
  }

  const fromHome = recoverExit === 'home'
  return (
    <QgScreen
      title='Recovery Kit'
      dismiss={fromHome ? () => navigate('home') : undefined}
      back={fromHome ? undefined : () => navigate(recoverExit)}
      footer={
        <>
          <RecoverAlert text={error || localError} />
          {hasRecoveryKit ? (
            <>
              <QgPrimary label='Save Recovery Kit' testId='download-recovery-kit' onClick={saveKit} />
              <QgSecondary
                label={busy ? 'Waiting for passkey…' : 'Back up map'}
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
            <QgPrimary
              label={busy ? 'Waiting for passkey…' : 'Get map'}
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
        </>
      }
    >
      <div className='vault-security'>
        <section className='vault-security-hero' aria-label='Recovery Kit status'>
          <div className='vault-security-hero-head'>
            <strong>Recovery Kit</strong>
            <span className={hasRecoveryKit ? 'is-ready' : 'is-attention'}>
              {hasRecoveryKit ? 'On this device' : 'Needed'}
            </span>
          </div>
          <h2>Keep your vault map available</h2>
          <p>
            The Recovery Kit is a public map of this vault—not a seed or private key. It lets recovery software rebuild
            the correct addresses and recovery paths, but cannot move bitcoin by itself.
          </p>
        </section>

        <HubGroup label='Keep a durable copy'>
          <HubRow
            title='On this device'
            detail={
              hasRecoveryKit
                ? 'The vault map is here. Save another copy outside this device.'
                : 'No vault map is available here. Restore it with your passkey or a saved file.'
            }
          />
          <HubRow
            title='When you need the file'
            detail='Use it with recovery software when this app cannot reconstruct your vault. Everyday payments do not need it.'
          />
          <HubRow
            title='When the file cannot help'
            detail='The map cannot sign, start recovery by itself, or replace a lost key. This device plus hardware can still move Savings without the service.'
          />
        </HubGroup>

        {report && 'trees' in report ? (
          <p className='qg-copy'>
            This kit is for vault {report.vaultId.slice(0, 8)}… · {report.trees.length} addresses
          </p>
        ) : null}
        {report && 'error' in report && pasted.trim() ? <RecoverAlert text={report.error} /> : null}
        <button type='button' className='qg-text' onClick={() => setShowPaste((open) => !open)}>
          I already have a kit file
        </button>
        {showPaste ? (
          <label className='qg-field'>
            <span>Recovery Kit</span>
            <input
              value={pasted}
              placeholder='Paste the file to check it'
              data-testid='recovery-kit-json'
              onChange={(event) => setPasted(event.target.value)}
            />
          </label>
        ) : null}

        <HubGroup label='If something is wrong'>
          <HubRow
            title='I lost a key'
            detail='Start a waiting period. Cancel if it wasn’t you.'
            onClick={() => {
              setLocalError('')
              setFromKit(true)
              setView('lost')
            }}
          />
          {matureBoardingSats > 0 ? (
            <HubRow
              title='Recover received Bitcoin'
              detail={`These funds have waited long enough to return onchain with this device. ${prettyAmount(matureBoardingSats)}`}
              onClick={() => setConfirmBoardingRecovery(true)}
              testId='recover-mature-boarding'
            />
          ) : null}
        </HubGroup>
        {confirmBoardingRecovery ? (
          <>
            <p className='qg-copy'>
              Your passkey will authorize a one-time recovery to this device. A network fee is deducted before the
              transaction is sent.
            </p>
            <QgPrimary
              label={recoveringBoarding ? 'Recovering…' : 'Recover to this device'}
              testId='recover-mature-boarding-confirm'
              disabled={recoveringBoarding}
              loading={recoveringBoarding}
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
      </div>
    </QgScreen>
  )
}
