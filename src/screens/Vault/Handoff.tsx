import { useContext, useMemo, useRef, useState } from 'react'
import Button from '../../components/Button'
import ButtonsOnBottom from '../../components/ButtonsOnBottom'
import Content from './Content'
import ErrorMessage from '../../components/Error'
import FlexCol from '../../components/FlexCol'
import Header from './Header'
import Input from '../../components/Input'
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
      <Content noRefresh className='vault-handoff-content'>
        <Padded>
          <FlexCol gap='1.15rem' className='vault-flow vault-handoff-flow'>
            <div className='vault-handoff-intro'>
              <p className='vault-kicker'>Pending Savings transfer</p>
              <p className='vault-handoff-amount'>{prettyAmount(spend.amount)}</p>
              <Text color='neutral-600' tiny wrap>
                This device has signed. Complete the transfer with your hardware key.
              </Text>
            </div>
            <section className='vault-handoff-step' aria-labelledby='vault-handoff-export-title'>
              <div className='vault-handoff-step-head'>
                <span aria-hidden='true'>1</span>
                <div>
                  <p id='vault-handoff-export-title'>Open on your hardware wallet</p>
                  <Text color='neutral-600' tiny wrap>
                    Copy the unsigned PSBT or show it as a QR code, then sign it with your hardware key.
                  </Text>
                </div>
              </div>
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
            </section>
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
            <section className='vault-handoff-step' aria-labelledby='vault-handoff-return-title'>
              <div className='vault-handoff-step-head'>
                <span aria-hidden='true'>2</span>
                <div>
                  <p id='vault-handoff-return-title'>Return the signed transaction</p>
                  <Text color='neutral-600' tiny wrap>
                    Upload the signed .psbt file, or paste the signed PSBT below.
                  </Text>
                </div>
              </div>
              <Button
                secondary
                label={selectedFile ? 'Choose a different PSBT' : 'Upload signed PSBT'}
                onClick={() => fileInput.current?.click()}
              />
              <Input
                label='Signed PSBT'
                placeholder='Paste signed PSBT (base64 or hex)'
                value={pasted}
                testId='savings-signed-psbt-paste'
                onChange={(value) => {
                  setPasted(value)
                  setSelectedFile('')
                  setFileError('')
                }}
              />
              {selectedFile ? (
                <Text color='neutral-600' tiny wrap>
                  {selectedFile} is ready to broadcast.
                </Text>
              ) : null}
            </section>
            <ErrorMessage error={Boolean(fileError || error)} text={fileError || error} />
            <button type='button' className='vault-inline-paste vault-handoff-delete' onClick={cancelSavingsHandoff}>
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
