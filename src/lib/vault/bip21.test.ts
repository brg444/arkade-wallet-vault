import { describe, expect, it } from 'vitest'
import { decodeVaultBip21, encodeVaultBip21, isVaultBip21 } from './bip21'

const arkadeAddress =
  'tark1qplnj2gett9j483fchy6chaxn4y52c4g7n5djh9xua3ywdxw0ldatc3e9xcj9xpx0r5tmr0dgvu2f4s352muklg0tcxx0scnnkraajy9jgz4xl'

describe('Vault BIP21', () => {
  it('encodes and decodes the unified receive request without float conversion', () => {
    const request = encodeVaultBip21({
      bitcoinAddress: 'tb1qexample',
      arkadeAddress,
      satoshis: 12_345_678,
    })

    expect(request).toBe(`bitcoin:tb1qexample?ark=${arkadeAddress}&amount=0.12345678`)
    expect(decodeVaultBip21(request)).toEqual({
      bitcoinAddress: 'tb1qexample',
      arkadeAddress,
      satoshis: 12_345_678,
    })
  })

  it('rejects excess precision and unknown required parameters', () => {
    expect(() => decodeVaultBip21('bitcoin:tb1qexample?amount=0.000000001')).toThrow()
    expect(() => decodeVaultBip21('bitcoin:tb1qexample?req-extra=1')).toThrow()
  })

  it('does not treat arbitrary text as BIP21', () => {
    expect(isVaultBip21('tark1not-a-uri')).toBe(false)
  })
})
