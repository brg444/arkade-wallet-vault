import type { VaultNetwork } from './constants'

export interface VaultKeys {
  phoneRoutineBip340: string
  phoneDirectP256: string
  externalOwnerWallet: string
  vaultCosignerBase: string
  tweakedVaultCosigner: string
  arkadeCosignerBase: string
  tweakedArkadeCosigner: string
}

export interface VaultPublicDescriptor {
  schema: 'arkade-vault/v4'
  network: VaultNetwork
  vaultId: string
  templateVersion: string
  policyVersion: string
  keys: VaultKeys
  arkadeCosigner: {
    origin: string
    version: string
  }
  csv: {
    operationalBlocks: number
    savingsBlocks: number
  }
  policy: {
    recipientDustSats: number
    recipientCapSats: number
    periodAllowanceSats: number
    absoluteFeeCapSats: number
    feerateCapSatVb: number
  }
  operational: {
    script: string
    address: string
  }
  savings: {
    script: string
    address: string
    excludesRoutineCosigners: boolean
  }
}

export interface VaultStatus {
  enrolled: boolean
  network: string
  clientOrigin: string
  rpId: string
  vaultId: string
  templateVersion: string
  policyVersion: string
  operationalCsvBlocks: number
  savingsCsvBlocks: number
  externalOwnerWalletPub?: string
  vaultCosignerBasePub?: string
  arkadeCosignerBasePub?: string
  arkadeCosignerOrigin?: string
  arkadeCosignerVersion?: string
  operationalAddress: string
  operationalScript?: string
  savingsAddress: string
  savingsExcludesRoutineCosigners: boolean
  periodAllowance: number
  periodSpent: number
  periodRemaining: number
  txCap: number
  absoluteFeeCap: number
  feerateCapSatVb: number
  phoneRoutineBip340Pub?: string
  phoneDirectP256?: string
  tweakedVaultCosignerXOnly?: string
  tweakedArkadeCosignerXOnly?: string
  enrollmentMode?: string
  passkeyLoginAvailable?: boolean
  savingsScript?: string
  recoveryPub?: string
  warnings?: string[]
}

export interface WatchRecord {
  descriptor: VaultPublicDescriptor
  descriptorHash: string
  importedAt: string
  authorizerOrigin: string
}
