import { Toaster, toast } from 'sonner'
import './Toast.css'

export { toast }

export const useToast = () => ({ toast })

const topToastOffset = 'max(32px, calc(var(--vault-safe-area-top, 0px) + 12px))'
const mobileTopToastOffset = 'max(16px, calc(var(--vault-safe-area-top, 0px) + 12px))'

export function ToastProvider({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <Toaster
        className='arkade-toast-toaster'
        position='top-center'
        offset={{ top: topToastOffset }}
        mobileOffset={{ top: mobileTopToastOffset }}
        richColors
        toastOptions={{
          classNames: {
            content: 'arkade-toast-content',
          },
          style: {
            background: 'var(--toast-bg, #1a1a1a)',
            color: 'var(--toast-color, #fafafa)',
            border: 'none',
            borderRadius: '12px',
            padding: '14px 20px',
            fontSize: '15px',
            fontWeight: 500,
            textAlign: 'center' as const,
            letterSpacing: '-0.01em',
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.2), 0 2px 8px rgba(0, 0, 0, 0.12)',
          },
          duration: 2000,
        }}
      />
    </>
  )
}
