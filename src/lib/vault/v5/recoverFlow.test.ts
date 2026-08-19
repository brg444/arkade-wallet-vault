import { describe, expect, it } from 'vitest'
import { inspectTransitionPsbt } from './spend'
import { V5_FIXTURE_FAMILY } from './fixtures'
import { planClaim, planClawback, planInitiate } from './recoverFlow'
import { buildV5Family } from './trees'

const COIN = { txid: '11'.repeat(32), vout: 0, value: 50_000 }

function memoryStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() {
      return map.size
    },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (key: string) => void map.delete(key),
    setItem: (key: string, value: string) => void map.set(key, value),
  }
}

describe('staged recover flow', () => {
  it('starts a hold to the matching Pending and records sign-once dest', () => {
    const family = buildV5Family(V5_FIXTURE_FAMILY)
    const storage = memoryStorage()
    const built = planInitiate({
      family,
      kind: 'savings',
      claimant: 'hardware',
      coin: COIN,
      feeSats: 500,
      vaultId: 'vault-a',
      storage,
    })
    expect(built.destAddress).toBe(family.pending['savings-hardware'].address)
    expect(inspectTransitionPsbt(built.psbtHex).p2aSats).toBe(240)
    expect(storage.getItem('arkade-vault-v5-replay-v1:vault-a')).toContain(COIN.txid)
  })

  it('clawback excludes the suspected claimant', () => {
    const family = buildV5Family(V5_FIXTURE_FAMILY)
    const built = planClawback({
      family,
      kind: 'savings',
      claimant: 'hardware',
      coin: COIN,
      feeSats: 500,
      vaultId: 'vault-a',
      storage: memoryStorage(),
    })
    expect(built.guardian).toBe('phone')
    expect(built.destAddress).toBe(family.quarantine['savings-hardware'].address)
    expect(() =>
      planClawback({
        family,
        kind: 'savings',
        claimant: 'hardware',
        guardian: 'hardware',
        coin: COIN,
        feeSats: 500,
        vaultId: 'vault-a',
        storage: memoryStorage(),
      }),
    ).toThrow(/guardian/)
  })

  it('refuses an immature claim when heights are known', () => {
    const family = buildV5Family(V5_FIXTURE_FAMILY)
    expect(() =>
      planClaim({
        family,
        kind: 'savings',
        claimant: 'hardware',
        coin: COIN,
        destAddress: family.daily.address,
        feeSats: 500,
        network: 'mutinynet',
        tipHeight: 104,
        confirmedHeight: 100,
      }),
    ).toThrow(/not mature/)
  })
})
