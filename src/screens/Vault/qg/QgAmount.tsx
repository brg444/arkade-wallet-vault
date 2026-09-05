import type { CSSProperties } from 'react'

export function amountSizeStyle(value: string): CSSProperties {
  return { '--qg-amount-length': Math.max(6, value.length) } as CSSProperties
}

export default function QgAmount({ value }: { value: string }) {
  const parts = value.match(/^([+−-]?)([₿$])(.*)$/)
  if (!parts) return <span className='qg-amount'>{value}</span>
  return (
    <span className='qg-amount'>
      {parts[1]}
      <span className='qg-amount-symbol'>{parts[2]}</span>
      {parts[3]}
    </span>
  )
}
