import { Intent, type DelegateInfo, type DelegateProvider, type SignedIntent } from '@arkade-os/sdk'
import { VAULT_POLICY_V1_DELEGATE_CAPABILITY, VAULT_POLICY_V1_DELEGATE_ORIGIN } from './script'

export interface VaultDelegatorProviderOptions {
  vaultOrigin: string
  vaultId: string
  fulmineOrigin?: string
  gatewaySecret?: string
}

interface VaultDelegateResponse {
  forwarded?: boolean
  reason?: string
  capability?: string
  authorizedForfeits?: string[]
}

/**
 * Lets SDK DelegatorManager build and user-sign the intent/forfeits, then
 * sends them to the vault for VaultCosigner addition. Fulmine is reached
 * only if the vault reports forwarded=true.
 */
export class VaultDelegatorProvider implements DelegateProvider {
  readonly vaultOrigin: string
  readonly vaultId: string
  readonly fulmineOrigin: string
  readonly gatewaySecret?: string

  constructor(opts: VaultDelegatorProviderOptions) {
    this.vaultOrigin = opts.vaultOrigin.replace(/\/$/, '')
    this.vaultId = opts.vaultId
    this.fulmineOrigin = (opts.fulmineOrigin ?? VAULT_POLICY_V1_DELEGATE_ORIGIN).replace(/\/$/, '')
    this.gatewaySecret = opts.gatewaySecret
  }

  async getDelegateInfo(): Promise<DelegateInfo> {
    const response = await fetch(`${this.fulmineOrigin}/v1/delegator/info`)
    if (!response.ok) {
      throw new Error(`Failed to get delegate info: ${await response.text()}`)
    }
    const data = (await response.json()) as DelegateInfo & { capabilities?: string[] }
    if (!data || typeof data.pubkey !== 'string' || data.pubkey === '') {
      throw new Error('Invalid delegate info')
    }
    const delegateAddress =
      typeof data.delegateAddress === 'string' && data.delegateAddress !== ''
        ? data.delegateAddress
        : typeof data.delegatorAddress === 'string' && data.delegatorAddress !== ''
          ? data.delegatorAddress
          : ''
    if (!delegateAddress) {
      throw new Error('Invalid delegate info')
    }
    return { ...data, delegateAddress }
  }

  async delegate(intent: SignedIntent<Intent.RegisterMessage>, forfeitTxs: string[]): Promise<void> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (this.gatewaySecret) headers['X-Vault-Gateway-Secret'] = this.gatewaySecret
    const response = await fetch(`${this.vaultOrigin}/v1/vtxo/delegate`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        vaultId: this.vaultId,
        intent: {
          message: Intent.encodeMessage(intent.message),
          proof: intent.proof,
        },
        forfeitTxs,
      }),
    })
    const text = await response.text()
    let body: VaultDelegateResponse = {}
    try {
      body = JSON.parse(text) as VaultDelegateResponse
    } catch {
      body = {}
    }
    if (!response.ok || body.forwarded !== true) {
      throw new Error(
        body.reason || `Fulmine forwarding disabled until ${VAULT_POLICY_V1_DELEGATE_CAPABILITY} is advertised`,
      )
    }
  }
}
