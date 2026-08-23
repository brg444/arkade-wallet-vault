import { describe, expect, it } from 'vitest'
import { delayLabel, humanDuration, truncateAddress, waitLabel } from './policy'

describe('vault policy copy', () => {
  it('names recovery delays in human time', () => {
    expect(waitLabel(288, 'mutinynet')).toMatch(/hour/)
    expect(waitLabel(4032)).toMatch(/day/)
    expect(delayLabel(288, 'mutinynet')).toMatch(/288/)
    expect(humanDuration(45)).toBe('about a minute')
  })

  it('shortens addresses without hiding they exist', () => {
    expect(truncateAddress('tb1ptestaddressvaluehere1234567890', 4)).toMatch(/tb1p…7890/)
    expect(truncateAddress('')).toBe('—')
  })
})
