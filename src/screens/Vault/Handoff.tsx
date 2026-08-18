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
import { useToast } from '../../components/Toast'
import { copyToClipboard } from '../../lib/clipboard'
import { prettyAmount } from '../../lib/format'
import { canBrowserShareData, shareData } from '../../lib/share'
import { encodePsbtFrames, parsePsbtFrame } from '../../lib/vault/savingsQr'
import { psbtFile, psbtHexToBase64 } from '../../lib/vault/savingsSpend'
import { VaultContext } from '../../providers/vault'
import PsbtQr from './PsbtQr'

async function sharePsbt(psbtHex: string) {
  const file = psbtFile(psbtHex)
  const text = psbtHexToBase64(psbtHex)
  if (canBrowserShareData({ files: [file] })) {
    await shareData({ files: [file], title: 'Savings PSBT' })
    return
  }
  if (canBrowserShareData({ text, title: 'Savings PSBT' })) {
    await shareData({ text, title: 'Savings PSBT' })
    return
  }
  await copyToClipboard(text)
}

export default function VaultHandoff() {
  const { busy, completeSavingsHandoff, error, handoffPsbt, navigate, spend } = useContext(VaultContext)
  const { toast } = useToast()
  const payload = useMemo(() => (handoffPsbt ? psbtHexToBase64(handoffPsbt) : ''), [handoffPsbt])
  const frames = useMemo(() => (payload ? encodePsbtFrames(payload) : []), [payload])
  const [frame, setFrame] = useState(0)
  const [scan, setScan] = useState(false)
  const [showQr, setShowQr] = useState(false)
  const [pasted, setPasted] = useState('')
  const canShare = Boolean(typeof navigator !== 'undefined' && navigator.share)

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
      <Header text='Hardware next' back={() => navigate('review')} />
      <Content noRefresh>
        <Padded>
          <FlexCol gap='1.15rem'>
            <Text wrap>
              This phone signed. Now hardware signs. Paste the signed transaction back. The hardware secret never comes
              here.
            </Text>
            <Text color='neutral-600' tiny wrap>
              {prettyAmount(spend.amount)}
            </Text>
            <Button
              label={canShare ? 'Share with hardware' : 'Copy for hardware'}
              onClick={() => {
                void (async () => {
                  try {
                    if (canShare) {
                      await sharePsbt(handoffPsbt)
                      return
                    }
                    await copyToClipboard(payload)
                    toast('Copied for hardware')
                  } catch (err) {
                    const msg = String(err)
                    if (/abort|cancel/i.test(msg)) return
                    await copyToClipboard(payload)
                    toast('Copied for hardware')
                  }
                })()
              }}
            />
            <button type='button' className='vault-inline-paste' onClick={() => setShowQr((open) => !open)}>
              {showQr ? 'Hide QR' : 'Show QR instead'}
            </button>
            {showQr ? (
              <>
                <PsbtQr value={current} />
                {frames.length > 1 ? (
                  <button
                    type='button'
                    className='vault-inline-paste'
                    onClick={() => setFrame((n) => (n + 1) % frames.length)}
                  >
                    Next QR
                  </button>
                ) : null}
              </>
            ) : null}
            <Input
              label='Signed transaction'
              value={pasted}
              onChange={setPasted}
              placeholder='Paste what hardware signed'
            />
            <ErrorMessage error={Boolean(error)} text={error} />
          </FlexCol>
        </Padded>
      </Content>
      <ButtonsOnBottom>
        <Button
          onClick={() => void completeSavingsHandoff(pasted)}
          disabled={busy || !pasted.trim()}
          loading={busy}
          label={busy ? 'Broadcasting…' : 'Broadcast'}
        />
        <Button onClick={() => setScan(true)} label='Scan signed transaction' secondary />
      </ButtonsOnBottom>
    </>
  )
}
