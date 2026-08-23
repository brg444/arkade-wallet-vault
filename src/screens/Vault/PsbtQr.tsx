import encodeQR from 'qr'

export default function PsbtQr({ value }: { value: string }) {
  if (!value) return null
  const matrix = encodeQR(value, 'raw', { ecc: 'medium', border: 2 })
  const module = 4
  const size = matrix.length * module
  const dots: JSX.Element[] = []
  for (let y = 0; y < matrix.length; y++) {
    for (let x = 0; x < matrix.length; x++) {
      if (!matrix[y][x]) continue
      dots.push(<rect key={`${x}-${y}`} x={x * module} y={y * module} width={module} height={module} fill='#040404' />)
    }
  }
  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      width='100%'
      style={{ maxWidth: 280, background: '#fff', borderRadius: 12, padding: 8, boxSizing: 'content-box' }}
      aria-label='PSBT QR'
    >
      {dots}
    </svg>
  )
}
