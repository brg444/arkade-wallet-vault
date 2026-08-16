import { describe, expect, it } from 'vitest'
import { delayLabel, humanDuration, truncateAddress } from './policy'

describe('vault policy copy', () => {
  it('names recovery delays in human time', () => {
    expect(delayLabel(288, 'mutinynet')).toMatch(/288/)
    expect(delayLabel(288, 'mutinynet')).toMatch(/hour/)
    expect(delayLabel(4032)).toMatch(/day/)
    expect(humanDuration(45)).toBe('about a minute')
  })

  it('shortens addresses without hiding they exist', () => {
    expect(truncateAddress('tb1ptestaddressvaluehere1234567890', 4)).toMatch(/tb1p…7890/)
    expect(truncateAddress('')).toBe('—')
  })
})
