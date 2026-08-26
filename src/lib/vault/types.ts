// Exact JSON object emitted by GET /v1/status?vault=... . Keep normalized
// compatibility aliases out of this type; they belong to VaultStatus below.
export interface VaultStatusWire {
  enrolled: boolean
  network: string
  clientOrigin: string
  rpId: string
  vaultId: string
  templateVersion: string
  policyVersion: string
  externalOwnerWalletPub?: string
  recoveryKeyPub?: string
  vaultCosignerBasePub?: string
  arkadeCosignerBasePub?: string
  arkadeCosignerOrigin: string
  arkadeCosignerVersion: string
  savingsAddress: string
  savingsScript?: string
  passkeyLoginAvailable: boolean
  enrollmentMode: string
  enrollmentExpiresAt?: string
  periodAllowance: number
  periodSpent: number
  periodRemaining: number
  txCap: number
  absoluteFeeCap: number
  feerateCapSatVb: number
  phoneBip340Pub?: string
  phoneDirectP256?: string
  warnings?: string[]
  vtxoVaultCosignerPub: string
  vtxoExitDelay: number
  vtxoExitDelayUnit: string
  spendingArkAddress: string
  spendingArkScript: string
  vtxoDelegatePub: string
  vtxoBoardingActive: boolean
  vtxoBoardingProgram: string
  vtxoBoardingAddress: string
  vtxoBoardingScript: string
  vtxoBoardingExitDelay: number
  vtxoBoardingExitDelayUnit: string
  // Present only for the explicitly gated vault-board-v2 release. The
  // descriptor is enrollment-bound and is required to reconstruct a worker
  // wallet in a fresh browser without trusting mutable client configuration.
  vtxoBoardingDescriptor?: VaultBoardV2Descriptor
  vtxoBoardingDescriptorHash?: string
}

// Wallet domain view. recoveryPub is a normalized compatibility alias and is
// never represented as a server wire field.
export interface VaultStatus {
  enrolled: boolean
  network: string
  clientOrigin: string
  rpId: string
  vaultId: string
  templateVersion: string
  policyVersion: string
  externalOwnerWalletPub?: string
  vaultCosignerBasePub?: string
  arkadeCosignerBasePub?: string
  arkadeCosignerOrigin?: string
  arkadeCosignerVersion?: string
  savingsAddress: string
  savingsScript: string
  periodAllowance: number
  periodSpent: number
  periodRemaining: number
  txCap: number
  absoluteFeeCap: number
  feerateCapSatVb: number
  phoneBip340Pub?: string
  phoneDirectP256?: string
  enrollmentMode?: string
  enrollmentExpiresAt?: string
  passkeyLoginAvailable?: boolean
  recoveryPub?: string
  recoveryKeyPub?: string
  warnings?: string[]
  vtxoVaultCosignerPub?: string
  vtxoExitDelay?: number
  vtxoExitDelayUnit?: string
  spendingArkAddress?: string
  spendingArkScript?: string
  vtxoDelegatePub?: string
  vtxoBoardingActive?: boolean
  vtxoBoardingProgram?: string
  vtxoBoardingAddress?: string
  vtxoBoardingScript?: string
  vtxoBoardingExitDelay?: number
  vtxoBoardingExitDelayUnit?: string
  vtxoBoardingDescriptor?: VaultBoardV2Descriptor
  vtxoBoardingDescriptorHash?: string
}

export interface VaultBoardV2Descriptor {
  schema: 'arkade-vault/board-v2'
  program: 'vault-board-v2'
  template: 'vault-board-v2-device-vault-and-operator'
  network: 'mutinynet'
  boardingPub: string
  recoveryPhonePub: string
  vaultBoardCosignerPub: string
  operatorPub: string
  exitDelay: number
  exitDelayUnit: 'seconds'
  script: string
  address: string
}
