import { useContext, useState } from 'react'
import Button from '../../components/Button'
import ButtonsOnBottom from '../../components/ButtonsOnBottom'
import Content from '../../components/Content'
import ErrorMessage from '../../components/Error'
import FlexCol from '../../components/FlexCol'
import Header from '../../components/Header'
import Padded from '../../components/Padded'
import Text from '../../components/Text'
import { sampleDescriptor } from '../../lib/vault/sample'
import { VaultContext } from '../../providers/vault'

export default function VaultInit() {
  const { error, importDescriptor, refreshStatus, status } = useContext(VaultContext)
  const [raw, setRaw] = useState('')
  const [localError, setLocalError] = useState('')
  const [busy, setBusy] = useState(false)

  const handleImport = () => {
    setLocalError('')
    try {
      importDescriptor(raw)
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'import failed')
    }
  }

  const handleFetch = async () => {
    setBusy(true)
    setLocalError('')
    try {
      await refreshStatus()
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'authorizer unreachable')
    } finally {
      setBusy(false)
    }
  }

  const handleSample = () => {
    setRaw(JSON.stringify(sampleDescriptor(), null, 2))
    setLocalError('')
  }

  return (
    <>
      <Header text='Vault mode' />
      <Content noRefresh>
        <Padded>
          <FlexCol>
            <Text wrap>
              This is the Arkade wallet shell in vault mode. It does not load VTXOs, swaps, or the existing passkey
              unlock. Import a v3 public descriptor, or fetch authorizer status.
            </Text>
            <Text color='neutral-600' small wrap>
              REGTEST / MUTINYNET ONLY. Watch-only. Do not fund a sample descriptor.
            </Text>
            <textarea
              aria-label='Vault descriptor JSON'
              value={raw}
              onChange={(event) => setRaw(event.target.value)}
              rows={10}
              style={{
                width: '100%',
                borderRadius: 12,
                padding: 12,
                fontFamily: 'ui-monospace, monospace',
                fontSize: 12,
                background: 'var(--field-bg, #1a1a1a)',
                color: 'inherit',
                border: '1px solid var(--border, #333)',
              }}
            />
            <ErrorMessage error={Boolean(localError || error)} text={localError || error} />
            {status ? (
              <Text small wrap>
                Authorizer {status.enrolled ? 'enrolled' : 'not enrolled'} on {status.network}. Operational{' '}
                {status.operationalAddress || '—'}
              </Text>
            ) : null}
          </FlexCol>
        </Padded>
      </Content>
      <ButtonsOnBottom>
        <Button onClick={handleImport} disabled={!raw.trim()} label='Import descriptor' />
        <Button onClick={handleFetch} disabled={busy} label={busy ? 'Fetching…' : 'Fetch authorizer status'} secondary />
        {import.meta.env.DEV ? <Button onClick={handleSample} label='Fill sample JSON' clear /> : null}
      </ButtonsOnBottom>
    </>
  )
}
