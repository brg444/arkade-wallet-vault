import { describe, expect, it } from 'vitest'
import { vaultTransactionExplorer } from './explorer'

describe('vaultTransactionExplorer', () => {
  it('routes Arkade transactions to the current Mutinynet Arkade Space deployment', () => {
    expect(vaultTransactionExplorer('ark-tx', 'arkade', 'mutinynet')).toEqual({
      label: 'View on Arkade Space',
      url: 'https://explorer.mutinynet.arkade.sh/tx/ark-tx',
    })
  })

  it('routes onchain transactions to the Mutinynet Bitcoin explorer', () => {
    expect(vaultTransactionExplorer('bitcoin-tx', 'onchain', 'mutinynet')).toEqual({
      label: 'View on Bitcoin explorer',
      url: 'https://mempool.mutinynet.arkade.sh/tx/bitcoin-tx',
    })
  })

  it('uses Arkade Space and the configured Bitcoin explorer on mainnet', () => {
    expect(vaultTransactionExplorer('ark-tx', 'arkade', 'bitcoin')?.url).toBe('https://arkade.space/tx/ark-tx')
    expect(vaultTransactionExplorer('bitcoin-tx', 'onchain', 'bitcoin')?.url).toBe(
      'https://mempool.space/tx/bitcoin-tx',
    )
  })

  it('does not invent an explorer for unsupported networks or empty transaction ids', () => {
    expect(vaultTransactionExplorer('tx', 'arkade', 'regtest')).toBeNull()
    expect(vaultTransactionExplorer('', 'onchain', 'mutinynet')).toBeNull()
  })
})
