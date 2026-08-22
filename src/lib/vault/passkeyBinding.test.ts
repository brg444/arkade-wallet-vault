import { describe, expect, it } from 'vitest'
import { accessMode, parseRecoveryBinding } from './passkeyBinding'
import { POLICY_VERSION } from './constants'

const SAVINGS_BINDING = {
  version: 2,
  credentialId: 'aa',
  webauthnP256: '02' + '11'.repeat(32),
  phoneDirectP256: '02' + '22'.repeat(32),
  phoneBip340Pub: '02' + '33'.repeat(32),
  externalOwnerWalletPub: '02' + '44'.repeat(32),
  vaultCosignerBasePub: '02' + '55'.repeat(32),
  arkadeCosignerBasePub: '02' + '66'.repeat(32),
  arkadeCosignerOrigin: 'https://mutinynet.arkade.sh',
  arkadeCosignerVersion: '0.4.65',
  clientOrigin: 'https://vault.example',
  rpId: 'vault.example',
  network: 'mutinynet',
  vaultId: 'vault-a',
  templateVersion: 'phone-hww-recovery-savings-v1',
  policyVersion: POLICY_VERSION,
  savingsAddress: 'tb1psavings',
  savingsScript: '5120' + '77'.repeat(32),
  recipientDustSats: 330,
  txRecipientCapSats: 50_000,
  periodAllowanceSats: 100_000,
  absoluteFeeCapSats: 5_000,
  feerateCapSatVb: 10,
  envelopeNonce: '88'.repeat(12),
  envelopeCiphertext: '99'.repeat(48),
}

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

describe('Savings recovery binding', () => {
  it('accepts the canonical v2 fields', () => {
    expect(parseRecoveryBinding(JSON.stringify(SAVINGS_BINDING))).toEqual(SAVINGS_BINDING)
  })

  it('rejects retired Daily fields and v1 bindings', () => {
    expect(() =>
      parseRecoveryBinding(JSON.stringify({ ...SAVINGS_BINDING, operationalAddress: 'tb1pretired' })),
    ).toThrow(/fields or order/)
    expect(() => parseRecoveryBinding(JSON.stringify({ ...SAVINGS_BINDING, version: 1 }))).toThrow(/version/)
  })
})
