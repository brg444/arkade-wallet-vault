import { useContext, useEffect, useRef, useState } from 'react'
import SpinnerIcon from '../../icons/Spinner'
import { sleep } from '../../lib/sleep'
import { reloadIfNewerWallet } from '../../lib/vault/update'
import { VaultContext } from '../../providers/vault'

function atTop() {
  if (window.scrollY > 0) return false
  const root = document.querySelector<HTMLElement>('[data-testid="vault-app"] .content')
  return !root || root.scrollTop <= 0
}

export default function VaultRefresher() {
  const { refreshBalance } = useContext(VaultContext)
  const [show, setShow] = useState(false)
  const startY = useRef(0)
  const pulled = useRef(false)
  const running = useRef(false)

  useEffect(() => {
    const run = async () => {
      if (running.current) return
      running.current = true
      setShow(true)
      try {
        const updating = await reloadIfNewerWallet()
        if (updating) return
        await refreshBalance()
      } finally {
        await sleep(420)
        setShow(false)
        running.current = false
        pulled.current = false
      }
    }

    const onTouchStart = (e: TouchEvent) => {
      startY.current = e.touches[0].clientY
      pulled.current = false
    }

    const onTouchMove = (e: TouchEvent) => {
      if (running.current || !atTop()) return
      const diff = e.touches[0].clientY - startY.current
      if (diff > 48) {
        pulled.current = true
        setShow(true)
        if (e.cancelable) e.preventDefault()
      }
    }

    const onTouchEnd = () => {
      if (pulled.current) void run()
    }

    const onWheel = (e: WheelEvent) => {
      if (running.current || !atTop() || e.deltaY >= 0) return
      e.preventDefault()
      void run()
    }

    document.addEventListener('touchstart', onTouchStart, { passive: true })
    document.addEventListener('touchmove', onTouchMove, { passive: false })
    document.addEventListener('touchend', onTouchEnd)
    document.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      document.removeEventListener('touchstart', onTouchStart)
      document.removeEventListener('touchmove', onTouchMove)
      document.removeEventListener('touchend', onTouchEnd)
      document.removeEventListener('wheel', onWheel)
    }
  }, [refreshBalance])

  return (
    <div className={`pull-to-refresh vault-refresh ${show ? 'show' : ''}`}>
      <SpinnerIcon />
    </div>
  )
}
