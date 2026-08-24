import { useContext, useMemo, useRef, useState } from 'react'
import Button from '../../components/Button'
import ButtonsOnBottom from '../../components/ButtonsOnBottom'
import Content from './Content'
import ErrorMessage from '../../components/Error'
import FlexCol from '../../components/FlexCol'
import Header from './Header'
import Padded from '../../components/Padded'
import Scanner from './Scanner'
import Text from '../../components/Text'
import { useToast } from '../../components/Toast'
import { copyToClipboard } from '../../lib/clipboard'
import { prettyAmount } from '../../lib/format'
import { encodePsbtFrames, parsePsbtFrame } from '../../lib/vault/savingsQr'
import { psbtHexToBase64, readPsbtFile } from '../../lib/vault/savingsSpend'
import { VaultContext } from '../../vault/context'
import PsbtQr from './PsbtQr'

export default function VaultHandoff() {
  const { busy, cancelSavingsHandoff, completeSavingsHandoff, error, handoffPsbt, navigate, spend } =
    useContext(VaultContext)
  const { toast } = useToast()
  const payload = useMemo(() => (handoffPsbt ? psbtHexToBase64(handoffPsbt) : ''), [handoffPsbt])
  const frames = useMemo(() => (payload ? encodePsbtFrames(payload) : []), [payload])
  const [frame, setFrame] = useState(0)
  const [scan, setScan] = useState(false)
  const [showQr, setShowQr] = useState(false)
  const [pasted, setPasted] = useState('')
  const [selectedFile, setSelectedFile] = useState('')
  const [fileError, setFileError] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)

  const current = frames[Math.min(frame, Math.max(frames.length - 1, 0))] || ''

  if (scan) {
    return (
      <Scanner
        close={() => setScan(false)}
        label='Signed PSBT'
        onData={(data) => {
          const parsed = parsePsbtFrame(data)
          setPasted(parsed ? parsed.payload : data)
          setSelectedFile('')
          setFileError('')
          setScan(false)
        }}
        onError={() => setScan(false)}
      />
    )
  }

  return (
    <>
      <Header text='Hardware next' back={() => navigate('home')} />
      <Content noRefresh>
        <Padded>
          <FlexCol gap='1.15rem'>
            <Text wrap>
              This device signed and saved the pending transfer. Sign the PSBT with your hardware key, then upload the
              signed .psbt file here.
            </Text>
            <Text color='neutral-600' tiny wrap>
              {prettyAmount(spend.amount)}
            </Text>
            <Button
              label='Copy PSBT'
              onClick={() => {
                void (async () => {
                  await copyToClipboard(payload)
                  toast('PSBT copied')
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
            <input
              ref={fileInput}
              hidden
              type='file'
              accept='.psbt,application/octet-stream'
              data-testid='savings-signed-psbt-file'
              onChange={(event) => {
                const input = event.currentTarget
                const file = input.files?.[0]
                input.value = ''
                if (!file) return
                setFileError('')
                void readPsbtFile(file)
                  .then((psbt) => {
                    setPasted(psbt)
                    setSelectedFile(file.name)
                  })
                  .catch(() => {
                    setPasted('')
                    setSelectedFile('')
                    setFileError('The selected file is not a valid PSBT.')
                  })
              }}
            />
            <Button
              secondary
              label={selectedFile ? 'Choose a different PSBT' : 'Upload signed PSBT'}
              onClick={() => fileInput.current?.click()}
            />
            {selectedFile ? (
              <Text color='neutral-600' tiny wrap>
                {selectedFile} is ready to broadcast.
              </Text>
            ) : null}
            <ErrorMessage error={Boolean(fileError || error)} text={fileError || error} />
            <button type='button' className='vault-inline-paste' onClick={cancelSavingsHandoff}>
              Delete pending transfer
            </button>
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
