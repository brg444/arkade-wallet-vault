import InputContainer from './InputContainer'
import { useRef, useEffect, ChangeEventHandler } from 'react'
import { cn } from '@/lib/utils'

interface InputProps {
  className?: string
  focus?: boolean
  label?: string
  max?: string
  maxLength?: number
  min?: string
  name?: string
  onChange: (arg0: any) => void
  onEnter?: () => void
  placeholder?: string
  readOnly?: boolean
  right?: JSX.Element
  step?: string
  testId?: string
  type?: 'text' | 'number' | 'url'
  value?: string | number
}

export default function Input({
  className,
  focus,
  label,
  max,
  maxLength,
  min,
  name,
  onChange,
  onEnter,
  placeholder,
  readOnly,
  right,
  step,
  testId,
  type = 'text',
  value,
}: InputProps) {
  const firstRun = useRef(true)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (focus && firstRun.current) {
      firstRun.current = false
      input.current?.focus()
    }
  })

  const handleChange: ChangeEventHandler<HTMLInputElement> = (ev) => {
    onChange(ev.currentTarget.value)
  }

  return (
    <InputContainer label={label} right={right}>
      <input
        aria-label={label}
        max={max}
        min={min}
        ref={input}
        step={step}
        type={type}
        value={value}
        className={cn('input', className)}
        data-testid={testId}
        name={name ?? testId}
        maxLength={maxLength}
        onChange={handleChange}
        placeholder={placeholder}
        readOnly={readOnly}
        onKeyUp={(ev) => ev.key === 'Enter' && onEnter && onEnter()}
      />
    </InputContainer>
  )
}
