export default function TransferArrowIcon({ incoming = false }: { incoming?: boolean }) {
  return (
    <svg aria-hidden='true' width='20' height='20' viewBox='0 0 20 20' fill='none'>
      {incoming ? (
        <path d='M15 5 5 15m0 0h7m-7 0V8' stroke='currentColor' strokeWidth='1.8' strokeLinecap='round' />
      ) : (
        <path d='M5 15 15 5m0 0H8m7 0v7' stroke='currentColor' strokeWidth='1.8' strokeLinecap='round' />
      )}
    </svg>
  )
}
