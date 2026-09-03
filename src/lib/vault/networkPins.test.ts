import { describe, expect, it } from 'vitest'
import { networkPins } from './networkPins'

describe('networkPins', () => {
  it('keeps Mutinynet delays and Operator identity unchanged', () => {
    const pins = networkPins('mutinynet')
    expect(pins.policyExitDelay).toBe(4608)
    expect(pins.boardExitDelay).toBe(604_672)
    expect(pins.operatorOrigin).toBe('https://mutinynet.arkade.sh')
    expect(pins.arkHrp).toBe('tark')
  })

  it('freezes mainnet to the public Operator contract', () => {
    const pins = networkPins('mainnet')
    expect(pins.policyExitDelay).toBe(605_184)
    expect(pins.boardExitDelay).toBe(7_776_256)
    expect(pins.operatorGetInfoNetwork).toBe('bitcoin')
    expect(pins.operatorOrigin).toBe('https://arkade.computer')
    expect(pins.delegateOrigin).toBe('https://delegate.arkade.money')
    expect(pins.arkHrp).toBe('ark')
  })

  it('rejects unknown networks', () => {
    expect(() => networkPins('regtest')).toThrow(/unsupported Vault network/)
  })
})
