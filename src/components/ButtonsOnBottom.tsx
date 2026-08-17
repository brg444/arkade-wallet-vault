import { ReactNode } from 'react'
import FlexCol from './FlexCol'

interface ButtonsOnBottomProps {
  children: ReactNode
  className?: string
}

export default function ButtonsOnBottom({ children, className }: ButtonsOnBottomProps) {
  return (
    <footer className={className ? `buttons-on-bottom ${className}` : 'buttons-on-bottom'}>
      <FlexCol gap='0.25rem' strech>
        {children}
      </FlexCol>
    </footer>
  )
}
