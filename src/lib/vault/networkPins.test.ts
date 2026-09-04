import { describe, expect, it } from 'vitest'
import { networkPins, requireSdkNetworkName, sdkNetworkName } from './networkPins'

describe('networkPins', () => {
  it('keeps Mutinynet delays and Operator identity unchanged', () => {
    const pins = networkPins('mutinynet')
    expect(pins.policyExitDelay).toBe(4608)
    expect(pins.boardExitDelay).toBe(604_672)
    expect(pins.operatorOrigin).toBe('https://mutinynet.arkade.sh')
    expect(pins.arkHrp).toBe('tark')
    expect(pins.absoluteFeeCeilingSats).toBe(5_000)
    expect(pins.feerateCeilingSatPerV).toBe(10)
  })

  it('freezes mainnet to the public Operator contract', () => {
    const pins = networkPins('mainnet')
    expect(pins.policyExitDelay).toBe(605_184)
    expect(pins.boardExitDelay).toBe(7_776_256)
    expect(pins.operatorGetInfoNetwork).toBe('bitcoin')
    expect(pins.operatorOrigin).toBe('https://arkade.computer')
    expect(pins.delegateOrigin).toBe('https://delegate.arkade.money')
    expect(pins.arkHrp).toBe('ark')
    expect(pins.absoluteFeeCeilingSats).toBe(20_000)
    expect(pins.feerateCeilingSatPerV).toBe(25)
  })

  it('rejects unknown networks', () => {
    expect(() => networkPins('regtest')).toThrow(/unsupported Vault network/)
  })

  it('maps Guardian mainnet onto the bitcoin SDK network name', () => {
    expect(sdkNetworkName('mainnet')).toBe('bitcoin')
    expect(sdkNetworkName('bitcoin')).toBe('bitcoin')
    expect(sdkNetworkName('mutinynet')).toBe('mutinynet')
    expect(requireSdkNetworkName('mainnet')).toBe('bitcoin')
    expect(sdkNetworkName('regtest')).toBeUndefined()
    expect(() => requireSdkNetworkName('regtest')).toThrow(/unsupported Vault network/)
  })
})
