import { describe, expect, it } from 'vitest'
import { accessMode, assertRecoveryBindingMatchesStatus, parseRecoveryBinding } from './passkeyBinding'
import { POLICY_VERSION } from './constants'
import type { VaultStatus } from './types'

const SAVINGS_BINDING = {
  version: 4,
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
  protectionTier: 'standard',
  savingsAddress: 'tb1psavings',
  savingsScript: '5120' + '77'.repeat(32),
  vtxoVaultCosignerPub: '02' + '88'.repeat(32),
  vtxoExitDelay: 4608,
  vtxoExitDelayUnit: 'seconds',
  spendingArkAddress: 'tark1spending',
  spendingArkScript: '5120' + '99'.repeat(32),
  vtxoDelegatePub: '02' + 'aa'.repeat(32),
  vtxoBoardingActive: true,
  vtxoBoardingProgram: 'vault-board-v1',
  vtxoBoardingAddress: 'tb1pboarding',
  vtxoBoardingScript: '5120' + 'bb'.repeat(32),
  vtxoBoardingExitDelay: 604672,
  vtxoBoardingExitDelayUnit: 'seconds',
  recipientDustSats: 330,
  txRecipientCapSats: 50_000,
  periodAllowanceSats: 100_000,
  absoluteFeeCapSats: 5_000,
  feerateCapSatVb: 10,
  envelopeNonce: 'cc'.repeat(12),
  envelopeCiphertext: 'dd'.repeat(48),
}

const STATUS = {
  enrolled: true,
  network: SAVINGS_BINDING.network,
  clientOrigin: SAVINGS_BINDING.clientOrigin,
  rpId: SAVINGS_BINDING.rpId,
  vaultId: SAVINGS_BINDING.vaultId,
  templateVersion: SAVINGS_BINDING.templateVersion,
  policyVersion: SAVINGS_BINDING.policyVersion,
  protectionTier: 'standard',
  externalOwnerWalletPub: SAVINGS_BINDING.externalOwnerWalletPub,
  vaultCosignerBasePub: SAVINGS_BINDING.vaultCosignerBasePub,
  arkadeCosignerBasePub: SAVINGS_BINDING.arkadeCosignerBasePub,
  arkadeCosignerOrigin: SAVINGS_BINDING.arkadeCosignerOrigin,
  arkadeCosignerVersion: SAVINGS_BINDING.arkadeCosignerVersion,
  savingsAddress: SAVINGS_BINDING.savingsAddress,
  savingsScript: SAVINGS_BINDING.savingsScript,
  periodAllowance: SAVINGS_BINDING.periodAllowanceSats,
  periodSpent: 0,
  periodRemaining: SAVINGS_BINDING.periodAllowanceSats,
  txCap: SAVINGS_BINDING.txRecipientCapSats,
  absoluteFeeCap: SAVINGS_BINDING.absoluteFeeCapSats,
  feerateCapSatVb: SAVINGS_BINDING.feerateCapSatVb,
  phoneBip340Pub: SAVINGS_BINDING.phoneBip340Pub,
  phoneDirectP256: SAVINGS_BINDING.phoneDirectP256,
  vtxoVaultCosignerPub: SAVINGS_BINDING.vtxoVaultCosignerPub,
  vtxoExitDelay: SAVINGS_BINDING.vtxoExitDelay,
  vtxoExitDelayUnit: SAVINGS_BINDING.vtxoExitDelayUnit,
  spendingArkAddress: SAVINGS_BINDING.spendingArkAddress,
  spendingArkScript: SAVINGS_BINDING.spendingArkScript,
  vtxoDelegatePub: SAVINGS_BINDING.vtxoDelegatePub,
  vtxoBoardingActive: SAVINGS_BINDING.vtxoBoardingActive,
  vtxoBoardingProgram: SAVINGS_BINDING.vtxoBoardingProgram,
  vtxoBoardingAddress: SAVINGS_BINDING.vtxoBoardingAddress,
  vtxoBoardingScript: SAVINGS_BINDING.vtxoBoardingScript,
  vtxoBoardingExitDelay: SAVINGS_BINDING.vtxoBoardingExitDelay,
  vtxoBoardingExitDelayUnit: SAVINGS_BINDING.vtxoBoardingExitDelayUnit,
} satisfies VaultStatus

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
  it('accepts the canonical v4 fields and exact tier, Spending, and boarding status', () => {
    expect(parseRecoveryBinding(JSON.stringify(SAVINGS_BINDING))).toEqual(SAVINGS_BINDING)
    expect(assertRecoveryBindingMatchesStatus(JSON.stringify(SAVINGS_BINDING), STATUS)).toEqual(SAVINGS_BINDING)
  })

  it('rejects retired fields and pre-v4 bindings', () => {
    expect(() =>
      parseRecoveryBinding(JSON.stringify({ ...SAVINGS_BINDING, operationalAddress: 'tb1pretired' })),
    ).toThrow(/fields or order/)
    expect(() => parseRecoveryBinding(JSON.stringify({ ...SAVINGS_BINDING, version: 3 }))).toThrow(/version/)
  })

  it.each([
    'vtxoVaultCosignerPub',
    'vtxoExitDelay',
    'vtxoExitDelayUnit',
    'spendingArkAddress',
    'spendingArkScript',
    'vtxoDelegatePub',
    'vtxoBoardingActive',
    'vtxoBoardingProgram',
    'vtxoBoardingAddress',
    'vtxoBoardingScript',
    'vtxoBoardingExitDelay',
    'vtxoBoardingExitDelayUnit',
    'protectionTier',
  ] as const)('rejects a recovery binding whose %s differs from status', (field) => {
    expect(() =>
      assertRecoveryBindingMatchesStatus(JSON.stringify(SAVINGS_BINDING), { ...STATUS, [field]: 'mutated' }),
    ).toThrow(new RegExp(`recovery binding ${field} does not match vault status`))
  })
})
