import { describe, expect, it } from 'vitest'
import { accessMode } from './passkeyBinding'

describe('vault access mode', () => {
  it('sends an enrolled visitor without local secrets to sign-in', () => {
    expect(accessMode({ enrolled: true, passkeyLoginAvailable: true }, { hasLocal: false })).toBe('signin')
  })

  it('asks the original device to enable recovery before other devices can sign in', () => {
    expect(accessMode({ enrolled: true, passkeyLoginAvailable: false }, { hasLocal: true })).toBe('enable')
  })

  it('keeps setup for an unenrolled deployment', () => {
    expect(accessMode({ enrolled: false, enrollmentMode: 'token' })).toBe('setup')
  })
})
