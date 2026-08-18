import { useContext, useMemo, useState } from 'react'
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
import { familyFromDescriptor } from '../../lib/vault/v5/descriptor'
import { inspectRecoveryKit, parseRecoveryKit } from '../../lib/vault/v5/kit'
import { planClaim, planClawback, planInitiate } from '../../lib/vault/v5/recoverFlow'
import { fetchAddressUtxos } from '../../lib/vault/esplora'
import { CLAIMANTS, VAULT_KINDS, type Claimant, type VaultKind } from '../../lib/vault/v5/constants'
import { VaultContext } from '../../providers/vault'
import { KeyCard } from './ui'

function downloadJson(name: string, body: string) {
  const hidden = document.createElement('a')
  hidden.href = URL.createObjectURL(new Blob([body], { type: 'application/json' }))
  hidden.download = name
  document.body.appendChild(hidden)
  hidden.click()
  hidden.remove()
}

export default function VaultRecover() {
  const { downloadRecoveryKit, error, initiateAlert, initiateAlerts, navigate, operationalAddress, savingsAddress } =
    useContext(VaultContext)
  const { toast } = useToast()
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
      return { error: err instanceof Error ? err.message : 'Not a Recovery Kit' }
    }
  }, [kitJson, pasted])

  return (
    <>
      <Header text='Recover' back={() => navigate('settings')} />
      <Content noRefresh>
        <Padded>
          <FlexCol>
            <Text wrap>
              Every hold is an alert. Guardians can send it to a vault that excludes the suspect. After the wait, only
              the claimant can take the coins. This app does not cancel for you.
            </Text>
            {initiateAlert ? (
              <KeyCard title='Hold in progress' role={initiateAlert} status='Alert' />
            ) : (
              <KeyCard title='No hold seen' role='This device watches Pending addresses when it is open.' />
            )}
            {initiateAlerts.map((item) => (
              <KeyCard
                key={`${item.txid}:${item.vout}`}
                title={item.familyKey}
                role={`${item.txid.slice(0, 8)}… · ${item.value} sats`}
              />
            ))}
            <Text wrap>Start a hold, claw it back, or claim after the wait. This app does not cancel for you.</Text>
            <select value={kind} onChange={(e) => setKind(e.target.value as VaultKind)} data-testid='recover-kind'>
              {VAULT_KINDS.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
            <select
              value={claimant}
              onChange={(e) => setClaimant(e.target.value as Claimant)}
              data-testid='recover-claimant'
            >
              {CLAIMANTS.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
            <Input
              label='Claim destination'
              placeholder='tb1p…'
              value={claimDest}
              onChange={setClaimDest}
              testId='recover-claim-dest'
            />
            {psbtOut ? (
              <Text color='neutral-600' tiny wrap>
                PSBT ready ({psbtOut.slice(0, 20)}…)
              </Text>
            ) : null}
            {report && 'trees' in report ? (
              <>
                <Text color='neutral-600' tiny wrap>
                  Vault {report.vaultId} · {report.hash.slice(0, 12)}…
                </Text>
                {report.trees.slice(0, 4).map((tree) => (
                  <KeyCard key={tree.role} title={tree.role} role={tree.address} />
                ))}
                <Text color='neutral-600' tiny wrap>
                  {report.warnings[0]}
                </Text>
              </>
            ) : null}
            {report && 'error' in report && pasted.trim() ? <ErrorMessage error text={report.error} /> : null}
            <Input
              label='Recovery Kit JSON'
              placeholder='Paste a kit to inspect'
              value={pasted}
              onChange={setPasted}
              testId='recovery-kit-json'
            />
            <ErrorMessage error={Boolean(error || localError)} text={error || localError} />
          </FlexCol>
        </Padded>
      </Content>
      <ButtonsOnBottom>
        <Button
          label='Start hold'
          testId='recover-initiate'
          onClick={() => {
            setLocalError('')
            void (async () => {
              try {
                const kit = parseRecoveryKit(JSON.parse(downloadRecoveryKit()))
                const family = familyFromDescriptor(kit.descriptor)
                const source = kind === 'daily' ? operationalAddress : savingsAddress
                if (!source) throw new Error('No source address')
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
                toast(`Hold dest ${built.destAddress.slice(0, 12)}…`)
              } catch (err) {
                setLocalError(err instanceof Error ? err.message : 'Could not start hold')
              }
            })()
          }}
        />
        <Button
          secondary
          label='Claw back latest'
          testId='recover-clawback'
          onClick={() => {
            setLocalError('')
            try {
              const latest = initiateAlerts[0]
              if (!latest) throw new Error('No hold seen')
              const [k, c] = latest.familyKey.split('-') as [VaultKind, Claimant]
              const kit = parseRecoveryKit(JSON.parse(downloadRecoveryKit()))
              const built = planClawback({
                family: familyFromDescriptor(kit.descriptor),
                kind: k,
                claimant: c,
                coin: { txid: latest.txid, vout: latest.vout, value: latest.value },
                feeSats: 500,
                vaultId: kit.descriptor.vaultId,
              })
              setPsbtOut(built.psbtHex)
              void copyToClipboard(built.psbtHex)
              toast(`Quarantine ${built.destAddress.slice(0, 12)}…`)
            } catch (err) {
              setLocalError(err instanceof Error ? err.message : 'Could not claw back')
            }
          }}
        />
        <Button
          secondary
          label='Build claim'
          testId='recover-claim'
          onClick={() => {
            setLocalError('')
            try {
              const latest = initiateAlerts[0]
              if (!latest || !claimDest.trim()) throw new Error('Need a seen hold and a destination')
              const [k, c] = latest.familyKey.split('-') as [VaultKind, Claimant]
              const kit = parseRecoveryKit(JSON.parse(downloadRecoveryKit()))
              const built = planClaim({
                family: familyFromDescriptor(kit.descriptor),
                kind: k,
                claimant: c,
                coin: { txid: latest.txid, vout: latest.vout, value: latest.value },
                destAddress: claimDest.trim(),
                feeSats: 500,
                network: kit.descriptor.network,
              })
              setPsbtOut(built.psbtHex)
              void copyToClipboard(built.psbtHex)
              toast('Claim PSBT copied. Dest is not pinned.')
            } catch (err) {
              setLocalError(err instanceof Error ? err.message : 'Could not claim')
            }
          }}
        />
        <Button
          label='Download Recovery Kit'
          testId='download-recovery-kit'
          onClick={() => {
            setLocalError('')
            try {
              const body = downloadRecoveryKit()
              downloadJson('arkade-recovery-kit.json', body)
              toast('Recovery Kit saved')
            } catch (err) {
              setLocalError(err instanceof Error ? err.message : 'No Recovery Kit yet')
            }
          }}
        />
        <Button
          secondary
          label='Share Recovery Kit'
          onClick={() => {
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
          }}
        />
      </ButtonsOnBottom>
    </>
  )
}
