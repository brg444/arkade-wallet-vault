import { describe, expect, it } from 'vitest'
import { bytesToHex } from './hex'
import { checksigScript, csvChecksigScript, encodeScriptInt, xOnlyFromCompressed } from './savingsTree'

const PHONE = '02f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9'
const HARDWARE = '02e493dbf1c10d80f3581e4904930b1404cc6c13900ee0758474fa94abe8c4cd13'

describe('Vault Program Savings tree', () => {
  it('encodes CSV integers the way ScriptBuilder does', () => {
    expect(bytesToHex(encodeScriptInt(6))).toBe('56')
    expect(bytesToHex(encodeScriptInt(144))).toBe('029000')
  })

  it('builds the admin and delayed leaves', () => {
    const phone = xOnlyFromCompressed(PHONE)
    const hw = xOnlyFromCompressed(HARDWARE)
    expect(bytesToHex(checksigScript([phone, hw]))).toBe(
      '20f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9ad20e493dbf1c10d80f3581e4904930b1404cc6c13900ee0758474fa94abe8c4cd13ac',
    )
    expect(bytesToHex(csvChecksigScript(144, phone))).toBe(
      '029000b27520f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9ac',
    )
    expect(bytesToHex(csvChecksigScript(6, hw))).toBe(
      '56b27520e493dbf1c10d80f3581e4904930b1404cc6c13900ee0758474fa94abe8c4cd13ac',
    )
  })
})
