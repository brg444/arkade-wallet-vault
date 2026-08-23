import InputWithScanner from '../../components/InputWithScanner'

interface AddressInputProps {
  label?: string
  onChange: (value: string) => void
  openScan: () => void
  placeholder?: string
  value?: string
  validator: (value: string) => boolean
}

export default function AddressInput({ label, onChange, openScan, placeholder, value, validator }: AddressInputProps) {
  return (
    <InputWithScanner
      label={label}
      onChange={onChange}
      openScan={openScan}
      placeholder={placeholder}
      validator={validator}
      value={value}
    />
  )
}
