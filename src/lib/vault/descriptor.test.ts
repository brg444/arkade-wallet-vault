import { describe, expect, it } from 'vitest'
import { encodeDescriptor, hashDescriptor, validateDescriptor } from './descriptor'
import { sampleDescriptor } from './sample'
import { bytesToHex } from './hex'

describe('v3 public descriptor', () => {
  it('encodes and hashes stably', () => {
    const a = hashDescriptor(sampleDescriptor())
    const b = hashDescriptor(sampleDescriptor())
    expect(a).toBe(b)
    expect(a).toHaveLength(64)
    expect(bytesToHex(encodeDescriptor(sampleDescriptor())).length).toBeGreaterThan(100)
  })

  it('changes hash when a role key changes', () => {
    const original = hashDescriptor(sampleDescriptor())
    const mutated = sampleDescriptor()
    mutated.keys.recoveryKey = '03d01115d548e7561b15c38f004d734633687cf4419620095bc5b0f47070afe85a'
    expect(hashDescriptor(mutated)).not.toBe(original)
  })

  it('rejects a v2 template', () => {
    const d = sampleDescriptor()
    d.templateVersion = 'phone-direct-p256-routine-3of3-admin-2of2-v2'
    expect(() => validateDescriptor(d)).toThrow(/template version/)
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
