import { useContext, useMemo, useState } from 'react'
import Button from '../../components/Button'
import ButtonsOnBottom from '../../components/ButtonsOnBottom'
import Content from '../../components/Content'
import ErrorMessage from '../../components/Error'
import FlexCol from '../../components/FlexCol'
import Header from '../../components/Header'
import Input from '../../components/Input'
import Padded from '../../components/Padded'
import Scanner from '../../components/Scanner'
import Text from '../../components/Text'
import { copyToClipboard } from '../../lib/clipboard'
import { prettyAmount } from '../../lib/format'
import { encodePsbtFrames, parsePsbtFrame } from '../../lib/vault/savingsQr'
import { psbtHexToBase64 } from '../../lib/vault/savingsSpend'
import { VaultContext } from '../../providers/vault'
import { useToast } from '../../components/Toast'
import PsbtQr from './PsbtQr'

export default function VaultHandoff() {
  const { busy, completeSavingsHandoff, error, handoffPsbt, navigate, spend } = useContext(VaultContext)
  const { toast } = useToast()
  const frames = useMemo(() => (handoffPsbt ? encodePsbtFrames(psbtHexToBase64(handoffPsbt)) : []), [handoffPsbt])
  const [frame, setFrame] = useState(0)
  const [scan, setScan] = useState(false)
  const [pasted, setPasted] = useState('')

  const current = frames[Math.min(frame, Math.max(frames.length - 1, 0))] || ''

  if (scan) {
    return (
      <Scanner
        close={() => setScan(false)}
        label='Signed PSBT'
        onData={(data) => {
          const parsed = parsePsbtFrame(data)
          setPasted(parsed ? parsed.payload : data)
          setScan(false)
        }}
        onError={() => setScan(false)}
      />
    )
  }

  return (
    <>
      <Header text='Hardware sign' back={() => navigate('review')} />
      <Content noRefresh>
        <Padded>
          <FlexCol>
            <Text wrap>
              This phone signed. Scan this QR on the hardware device, sign there, then scan the signed PSBT back. The
              hardware key never comes here.
            </Text>
            <Text color='neutral-600' tiny wrap>
              {prettyAmount(spend.amount)} · {frames.length > 1 ? `QR ${frame + 1} of ${frames.length}` : 'One QR'}
            </Text>
            <PsbtQr value={current} />
            {frames.length > 1 ? (
              <Button label='Next QR' secondary onClick={() => setFrame((n) => (n + 1) % frames.length)} />
            ) : null}
            <Button
              label='Copy PSBT'
              secondary
              onClick={() => {
                void copyToClipboard(psbtHexToBase64(handoffPsbt))
                toast('PSBT copied')
              }}
            />
            <Input label='Signed PSBT' value={pasted} onChange={setPasted} placeholder='Paste signed PSBT' />
            <ErrorMessage error={Boolean(error)} text={error} />
          </FlexCol>
        </Padded>
      </Content>
      <ButtonsOnBottom>
        <Button onClick={() => setScan(true)} label='Scan signed PSBT' secondary />
        <Button
          onClick={() => void completeSavingsHandoff(pasted)}
          disabled={busy || !pasted.trim()}
          loading={busy}
          label={busy ? 'Broadcasting…' : 'Broadcast'}
        />
      </ButtonsOnBottom>
    </>
  )
}
