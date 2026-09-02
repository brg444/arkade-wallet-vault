import { prettyLongText } from '../lib/format'
import { copyToClipboard } from '../lib/clipboard'
import { useToast } from './Toast'
import { hapticSubtle } from '../lib/haptics'
import ExternalLinkIcon from '../icons/ExternalLink'

export type TableLine = [string, string | undefined, JSX.Element?, (() => void)?]
export type TableData = TableLine[]

export default function Table({ data }: { data: TableData }) {
  const { toast } = useToast()

  const copy = async (value: string) => {
    hapticSubtle()
    try {
      await copyToClipboard(value)
      toast('Copied to clipboard')
    } catch {
      toast('Failed to copy')
    }
  }

  return (
    <div className='vault-table'>
      {data.map(([title, value, icon, onClick]) =>
        value == '' || value === undefined || value === null ? null : (
          <button
            type='button'
            className='vault-table-row'
            key={title}
            aria-label={`${onClick ? 'Open' : 'Copy'} ${title}: ${value}`}
            onClick={() => (onClick ? onClick() : void copy(value))}
          >
            <span className='vault-table-title'>
              {icon}
              <span>{title}</span>
            </span>
            <span className='vault-table-value' data-testid={title} title={value}>
              <span>{onClick ? prettyLongText(value, 18) : value}</span>
              {onClick ? <ExternalLinkIcon /> : null}
            </span>
          </button>
        ),
      )}
    </div>
  )
}
