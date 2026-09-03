export default function HollowPixelMark({ size = 23 }: { size?: number }) {
  return (
    <svg aria-hidden='true' width={size} height={size} viewBox='0 0 21 21' fill='currentColor'>
      <rect x='7' width='7' height='7' />
      <rect y='7' width='7' height='7' />
      <rect x='14' y='7' width='7' height='7' />
      <rect x='7' y='14' width='7' height='7' />
    </svg>
  )
}
