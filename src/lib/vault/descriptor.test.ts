import { describe, expect, it } from 'vitest'
import { encodeDescriptor, hashDescriptor, validateDescriptor } from './descriptor'
import { sampleDescriptor } from './sample'
import { bytesToHex } from './hex'

describe('v4 public descriptor', () => {
  it('encodes and hashes stably', () => {
    const a = hashDescriptor(sampleDescriptor())
    const b = hashDescriptor(sampleDescriptor())
    expect(a).toBe(b)
    expect(a).toHaveLength(64)
    expect(bytesToHex(encodeDescriptor(sampleDescriptor())).length).toBeGreaterThan(100)
  })

  it('changes hash when hardware or either CSV changes', () => {
    const original = hashDescriptor(sampleDescriptor())
    const hardware = sampleDescriptor()
    hardware.keys.externalOwnerWallet = '03d01115d548e7561b15c38f004d734633687cf4419620095bc5b0f47070afe85a'
    expect(hashDescriptor(hardware)).not.toBe(original)
    const csvPhone = sampleDescriptor()
    csvPhone.csv.operationalBlocks = 7
    expect(hashDescriptor(csvPhone)).not.toBe(original)
    const csvHw = sampleDescriptor()
    csvHw.csv.savingsBlocks = 145
    expect(hashDescriptor(csvHw)).not.toBe(original)
    expect(sampleDescriptor().keys).not.toHaveProperty('recoveryKey')
    expect(sampleDescriptor().keys).not.toHaveProperty('recoveryKeyXOnly')
  })

  it('rejects a leftover recovery key field', () => {
    const d = sampleDescriptor()
    ;(d.keys as { recoveryKey?: string }).recoveryKey = '02' + '11'.repeat(32)
    expect(() => validateDescriptor(d)).toThrow(/recovery key/)
    const xonly = sampleDescriptor()
    ;(xonly.keys as { recoveryKeyXOnly?: string }).recoveryKeyXOnly = '11'.repeat(32)
    expect(() => validateDescriptor(xonly)).toThrow(/recovery key/)
  })

  it('rejects a v3 template and schema', () => {
    const d = sampleDescriptor()
    d.templateVersion = 'phone-direct-p256-routine-3of3-admin-2of2-v3'
    expect(() => validateDescriptor(d)).toThrow(/template version/)
    const schema = sampleDescriptor()
    ;(schema as { schema: string }).schema = 'arkade-vault/v3'
    expect(() => validateDescriptor(schema)).toThrow(/schema/)
  })

  it('rejects savings that include routine cosigners', () => {
    const d = sampleDescriptor()
    d.savings.excludesRoutineCosigners = false
    expect(() => validateDescriptor(d)).toThrow(/exclude/)
  })

  it('does not hash JSON stringification', () => {
    const d = sampleDescriptor()
    const hashed = hashDescriptor(d)
    const json = JSON.stringify(d)
    expect(hashed).not.toBe(json)
    expect(hashed).toHaveLength(64)
  })
})
