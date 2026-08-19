import { useMemo, useState } from 'react'
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
import { humanizeVaultError } from '../../lib/vault/humanize'
import { createPsbtFrameBuffer, encodePsbtFrames, parsePsbtFrame } from '../../lib/vault/savingsQr'
import { parseHardwareSecret, parseIncomingPsbt, psbtHexToBase64, signSavingsPsbt } from '../../lib/vault/savingsSpend'
import { zeroBytes } from '../../lib/vault/ceremony/directauth.js'
import { useToast } from '../../components/Toast'
import PsbtQr from './PsbtQr'

export default function VaultHwSign({ onBack }: { onBack: () => void }) {
  const { toast } = useToast()
  const [scan, setScan] = useState(false)
  const [incoming, setIncoming] = useState('')
  const [secret, setSecret] = useState('')
  const [signed, setSigned] = useState('')
  const [frame, setFrame] = useState(0)
  const [error, setError] = useState('')
  const buffer = useMemo(() => createPsbtFrameBuffer(), [])
  const frames = signed ? encodePsbtFrames(psbtHexToBase64(signed)) : []

  if (scan) {
    return (
      <Scanner
        close={() => setScan(false)}
        label='Device PSBT'
        onData={(data) => {
          try {
            const frameIn = parsePsbtFrame(data)
            if (frameIn) {
              const progress = buffer.add(data)
              const done = buffer.complete()
              if (done) setIncoming(done)
              else setError(`QR ${progress.have} of ${progress.total}`)
            } else {
              setIncoming(parseIncomingPsbt(data))
            }
            setError('')
          } catch (err) {
            setError(humanizeVaultError(err))
          }
          setScan(false)
        }}
        onError={() => setScan(false)}
      />
    )
  }

  return (
    <>
      <Header text='Sign with hardware' back={onBack} />
      <Content noRefresh>
        <Padded>
          <FlexCol>
            <Text wrap>
              This is the hardware device. Scan the QR from the other device, sign with the hardware key, then show the
              QR back. Don’t save the key on this device.
            </Text>
            <Input label='Device PSBT' value={incoming} onChange={setIncoming} placeholder='Paste or scan' />
            <Input label='Hardware key' value={secret} onChange={setSecret} placeholder='WIF or 64-char hex' />
            <ErrorMessage error={Boolean(error)} text={error} />
            {signed ? (
              <>
                <Text color='neutral-600' tiny>
                  Signed. Scan this on the other device.
                </Text>
                <PsbtQr value={frames[Math.min(frame, frames.length - 1)] || ''} />
                {frames.length > 1 ? (
                  <Button label='Next QR' secondary onClick={() => setFrame((n) => (n + 1) % frames.length)} />
                ) : null}
              </>
            ) : null}
          </FlexCol>
        </Padded>
      </Content>
      <ButtonsOnBottom>
        <Button onClick={() => setScan(true)} label='Scan device QR' secondary />
        {signed ? (
          <Button
            label='Copy signed PSBT'
            onClick={() => {
              void copyToClipboard(psbtHexToBase64(signed))
              toast('Signed PSBT copied')
            }}
          />
        ) : (
          <Button
            label='Sign'
            disabled={!incoming.trim() || !secret.trim()}
            onClick={() => {
              let priv: Uint8Array | undefined
              try {
                setError('')
                priv = parseHardwareSecret(secret)
                setSigned(signSavingsPsbt(parseIncomingPsbt(incoming), priv))
                setSecret('')
                setFrame(0)
              } catch (err) {
                setError(humanizeVaultError(err))
              } finally {
                if (priv) zeroBytes(priv)
              }
            }}
          />
        )}
      </ButtonsOnBottom>
    </>
  )
}
