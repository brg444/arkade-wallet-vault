import { describe, expect, it, vi, afterEach } from 'vitest'
import { VAULT_POLICY_V1_DELEGATE_CAPABILITY, VAULT_POLICY_V1_DELEGATE_ORIGIN } from './script'
import { VaultDelegatorProvider } from './delegator'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('VaultDelegatorProvider', () => {
  it('reads delegate info from the pinned Fulmine origin', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe(`${VAULT_POLICY_V1_DELEGATE_ORIGIN}/v1/delegator/info`)
      expect(init?.redirect).toBe('error')
      return new Response(
        JSON.stringify({
          pubkey: '032903b15efe236d9609da10e536fb32cdf1d144778797bbf32a9b94e86601be6a',
          fee: '0',
          delegatorAddress: 'tark1qqqq',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    })
    vi.stubGlobal('fetch', fetchMock)
    const provider = new VaultDelegatorProvider({ vaultOrigin: 'http://vault.local', vaultId: 'v1' })
    const info = await provider.getDelegateInfo()
    expect(info.pubkey.startsWith('032903')).toBe(true)
    expect(info.delegateAddress).toBe('tark1qqqq')
  })

  it('rejects delegate info that does not match the contract pin', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              pubkey: '03ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
              fee: '0',
              delegatorAddress: 'tark1qqqq',
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
      ),
    )
    const provider = new VaultDelegatorProvider({ vaultOrigin: 'http://vault.local', vaultId: 'v1' })
    await expect(provider.getDelegateInfo()).rejects.toThrow(/pinned public delegate/)
  })

  it('fail-closes when the vault does not forward to Fulmine', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe('http://vault.local/v1/vtxo/delegate')
      return new Response(
        JSON.stringify({
          forwarded: false,
          reason: 'fulmine does not advertise multi-presigned-signature',
          capability: VAULT_POLICY_V1_DELEGATE_CAPABILITY,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    })
    vi.stubGlobal('fetch', fetchMock)
    const provider = new VaultDelegatorProvider({ vaultOrigin: 'http://vault.local', vaultId: 'v1' })
    await expect(
      provider.delegate(
        {
          message: {
            type: 'register',
            onchain_output_indexes: [],
            valid_at: 0,
            expire_at: 0,
            cosigners_public_keys: [],
          },
          proof: 'cHNi',
        },
        ['cHNi'],
      ),
    ).rejects.toThrow(/multi-presigned-signature|forwarding disabled/)
  })
})
