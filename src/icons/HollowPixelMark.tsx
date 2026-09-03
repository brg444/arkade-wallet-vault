export default function HollowPixelMark({ size = 23 }: { size?: number }) {
  return (
    <svg aria-hidden='true' width={size} height={size} viewBox='0 0 23 23' fill='currentColor'>
      <rect x='8' width='7' height='7' />
      <rect y='8' width='7' height='7' />
      <rect x='16' y='8' width='7' height='7' />
      <rect x='8' y='16' width='7' height='7' />
    </svg>
  )
}
