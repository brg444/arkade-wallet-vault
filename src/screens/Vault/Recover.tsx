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

  return (
    <>
      <Header text='Recovery Kit' back={() => navigate('settings')} />
      <Content noRefresh>
        <Padded>
          <FlexCol>
            <Text wrap>
              The Recovery Kit is how you get coins out if this app is gone. Save it now, somewhere you can find later.
              It is not a seed. It does not hold your keys.
            </Text>
            <KeyCard
              title='Why you save it'
              role='If Arkade or this phone app disappears, this file is the map of your vault. With a key you still hold, you can start recovery, cancel it, or move coins after the wait — including from the offline tool.'
            />
            <KeyCard
              title='When you use it'
              role='This app is gone, or you can’t open it. Everyday send and sign-in on a new phone do not use the kit.'
            />
            <KeyCard
              title='When you don’t'
              role='It cannot move coins from the original address if both vault services are gone. This phone plus hardware still can.'
            />

            {initiateAlert ? (
              <KeyCard title='Recovery in process' role={initiateAlert} status='Alert' />
            ) : (
              <KeyCard
                title='No recovery in process'
                role='If someone starts one, this phone can warn you while the app is open.'
              />
            )}
            {initiateAlerts.map((item) => {
              const [account, key] = item.familyKey.split('-') as [VaultKind, Claimant]
              return (
                <KeyCard
                  key={`${item.txid}:${item.vout}`}
                  title={`${ACCOUNT_LABEL[account]} · ${KEY_LABEL[key]}`}
                  role={`${item.value.toLocaleString()} sats waiting`}
                />
              )
            })}
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

            <Reveal label='I lost a key'>
              <Text color='neutral-600' tiny wrap>
                Which account, and which key is gone?
              </Text>
              {VAULT_KINDS.map((item) => (
                <ChoiceCard
                  key={item}
                  title={ACCOUNT_LABEL[item]}
                  detail={item === 'daily' ? 'This device can spend today' : 'Needs hardware too'}
                  selected={kind === item}
                  onClick={() => setKind(item)}
                  testId={`recover-kind-${item}`}
                />
              ))}
              {CLAIMANTS.map((item) => (
                <ChoiceCard
                  key={item}
                  title={KEY_LABEL[item]}
                  detail={
                    item === 'phone'
                      ? 'This phone or its passkey'
                      : item === 'hardware'
                        ? 'The hardware key'
                        : 'The optional recovery key'
                  }
                  selected={claimant === item}
                  onClick={() => setClaimant(item)}
                  testId={`recover-key-${item}`}
                />
              ))}
              <Input
                label='After the wait, send coins here'
                placeholder='tb1p…'
                value={claimDest}
                onChange={setClaimDest}
                testId='recover-claim-dest'
              />
              {psbtOut ? (
                <Text color='neutral-600' tiny wrap>
                  Transaction copied. Sign it with the key you still have.
                </Text>
              ) : null}
            </Reveal>

            <ErrorMessage error={Boolean(error || localError)} text={error || localError} />
          </FlexCol>
        </Padded>
      </Content>
      <ButtonsOnBottom>
        <Button label='Save Recovery Kit' testId='download-recovery-kit' onClick={saveKit} />
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
        <Button
          secondary
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
        <Button
          secondary
          label='Cancel recovery'
          testId='recover-clawback'
          onClick={() => {
            setLocalError('')
            try {
              const latest = initiateAlerts[0]
              if (!latest) throw new Error('No recovery in process')
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
          onClick={() => {
            setLocalError('')
            try {
              const latest = initiateAlerts[0]
              if (!latest || !claimDest.trim()) throw new Error('Need a recovery in process and a destination')
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
              toast('Move copied. Only after the wait.')
            } catch (err) {
              setLocalError(err instanceof Error ? err.message : 'Could not move coins')
            }
          }}
        />
      </ButtonsOnBottom>
    </>
  )
}
