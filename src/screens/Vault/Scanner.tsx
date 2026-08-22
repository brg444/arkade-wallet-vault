import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { QRCanvas, frameLoop, frontalCamera } from 'qr/dom.js'
import QrScanner from 'qr-scanner'
import Button from '../../components/Button'
import ButtonsOnBottom from '../../components/ButtonsOnBottom'
import ErrorMessage from '../../components/Error'
import Padded from '../../components/Padded'
import { extractError } from '../../lib/error'
import Content from './Content'
import Header from './Header'

const videoStyle: CSSProperties = {
  border: '1px solid var(--neutral-300)',
  borderRadius: '0.5rem',
  margin: '0 auto',
}

interface ScannerProps {
  close: () => void
  label: string
  onData: (value: string) => void
  onError: (error: string) => void
  onSwitch?: () => void
  calculateScanRegion?: (video: HTMLVideoElement) => QrScanner.ScanRegion
}

export default function VaultScanner({ close, label, onData, onError }: ScannerProps) {
  const [implementation, setImplementation] = useState<'qr' | 'qrmini' | 'mills'>('qr')
  const next = () =>
    setImplementation(implementation === 'qr' ? 'qrmini' : implementation === 'qrmini' ? 'mills' : 'qr')

  if (implementation === 'qr') {
    return <ScannerQr close={close} label={label} onData={onData} onError={onError} onSwitch={next} />
  }
  if (implementation === 'qrmini') {
    return <ScannerQrMini close={close} label={label} onData={onData} onError={onError} onSwitch={next} />
  }
  return <ScannerMills close={close} label={label} onData={onData} onError={onError} onSwitch={next} />
}

function ScannerMills({ close, label, onData, onError, onSwitch }: ScannerProps) {
  const [error, setError] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const cameraRef = useRef<any>(null)
  const canvasRef = useRef<QRCanvas | null>(null)
  const cancelRef = useRef<(() => void) | null>(null)

  const stop = () => {
    cancelRef.current?.()
    cancelRef.current = null
    cameraRef.current?.stop()
    cameraRef.current = null
  }
  const closeScanner = () => {
    stop()
    close()
  }

  useEffect(() => {
    let cancelled = false
    const start = async () => {
      if (!videoRef.current) return
      try {
        canvasRef.current?.clear()
        const canvas = new QRCanvas()
        const camera = await frontalCamera(videoRef.current)
        if (cancelled) {
          camera.stop()
          return
        }
        const devices = await camera.listDevices()
        await camera.setDevice(devices[devices.length - 1].deviceId)
        canvasRef.current = canvas
        cameraRef.current = camera
        cancelRef.current = frameLoop(() => {
          const value = camera.readFrame(canvas)
          if (value) {
            onData(value)
            closeScanner()
          }
        })
      } catch (cause) {
        onError(extractError(cause))
        setError(true)
      }
    }
    void start()
    return () => {
      cancelled = true
      stop()
    }
  }, [])

  const switchScanner = () => {
    stop()
    onSwitch?.()
  }

  return (
    <>
      <Header auxFunc={switchScanner} auxText='M' text={label} back={closeScanner} />
      <Content noRefresh>
        <Padded>
          <ErrorMessage error={error} text='Camera not available' />
          <video style={videoStyle} ref={videoRef} />
        </Padded>
      </Content>
      <ButtonsOnBottom>
        <Button onClick={closeScanner} label='Cancel' />
      </ButtonsOnBottom>
    </>
  )
}

function ScannerQr({ calculateScanRegion, close, label, onData, onError, onSwitch }: ScannerProps) {
  const [error, setError] = useState(false)
  const [hasCamera, setHasCamera] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const scannerRef = useRef<QrScanner | null>(null)

  const stop = () => {
    scannerRef.current?.destroy()
    scannerRef.current = null
  }
  const closeScanner = () => {
    stop()
    close()
  }

  useEffect(() => {
    void QrScanner.hasCamera().then(setHasCamera)
  }, [])

  useEffect(() => {
    if (!hasCamera || !videoRef.current) return
    const scanner = new QrScanner(
      videoRef.current,
      (result) => {
        onData(result.data)
        closeScanner()
      },
      {
        maxScansPerSecond: 100,
        highlightScanRegion: true,
        highlightCodeOutline: true,
        onDecodeError: () => {},
        calculateScanRegion,
      },
    )
    scannerRef.current = scanner
    scanner.start().catch((cause) => {
      onError(extractError(cause))
      setError(true)
    })
    return stop
  }, [hasCamera])

  const switchScanner = () => {
    stop()
    onSwitch?.()
  }

  return (
    <>
      <Header auxFunc={switchScanner} auxText={calculateScanRegion ? 'q' : 'Q'} text={label} back={closeScanner} />
      <Content noRefresh>
        <Padded>
          <ErrorMessage error={error} text='Camera not available' />
          <div id='video-wrapper'>
            <video id='qr-scanner' ref={videoRef} style={videoStyle} />
          </div>
        </Padded>
      </Content>
      <ButtonsOnBottom>
        <Button onClick={closeScanner} label='Cancel' />
      </ButtonsOnBottom>
    </>
  )
}

function ScannerQrMini(props: ScannerProps) {
  const calculateScanRegion = (video: HTMLVideoElement): QrScanner.ScanRegion => {
    const smallestDimension = Math.min(video.videoWidth, video.videoHeight)
    const size = Math.round(smallestDimension / 4)
    return {
      x: Math.round((video.videoWidth - size) / 2),
      y: Math.round((video.videoHeight - size) / 2),
      width: size,
      height: size,
    }
  }
  return <ScannerQr {...props} calculateScanRegion={calculateScanRegion} />
}
