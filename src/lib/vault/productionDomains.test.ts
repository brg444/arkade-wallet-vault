import { describe, expect, it } from 'vitest'
import { MAINNET_WALLET_HOSTS as GATEWAY_MAINNET_WALLET_HOSTS } from '../../../api/mainnetHosts'
import {
  MAINNET_WALLET_HOSTS,
  VAULTED_GUARDIAN_HOST,
  VAULTED_MARKETING_ORIGIN,
  VAULTED_RC_ORIGIN,
  VAULTED_RC_RP_ID,
  VAULTED_WALLET_ORIGIN,
  VAULTED_WALLET_RP_ID,
  isMainnetWalletHost,
  isMainnetWalletOrigin,
  requireMainnetWalletOrigin,
  requireMainnetWalletRpId,
} from './productionDomains'

describe('Vaulted production domains', () => {
  it('pins the public getvaulted.xyz product names', () => {
    expect(VAULTED_MARKETING_ORIGIN).toBe('https://getvaulted.xyz')
    expect(VAULTED_WALLET_ORIGIN).toBe('https://app.getvaulted.xyz')
    expect(VAULTED_WALLET_RP_ID).toBe('app.getvaulted.xyz')
    expect(VAULTED_GUARDIAN_HOST).toBe('guardian.getvaulted.xyz')
    expect(VAULTED_RC_ORIGIN).toBe('https://rc.getvaulted.xyz')
    expect(VAULTED_RC_RP_ID).toBe('rc.getvaulted.xyz')
    expect(MAINNET_WALLET_HOSTS).toEqual(['app.getvaulted.xyz', 'rc.getvaulted.xyz'])
    expect(GATEWAY_MAINNET_WALLET_HOSTS).toEqual(MAINNET_WALLET_HOSTS)
  })

  it('accepts only the release-pinned mainnet wallet origins and RP IDs', () => {
    expect(requireMainnetWalletOrigin('https://app.getvaulted.xyz')).toBe('https://app.getvaulted.xyz')
    expect(requireMainnetWalletOrigin('https://rc.getvaulted.xyz')).toBe('https://rc.getvaulted.xyz')
    expect(requireMainnetWalletRpId('app.getvaulted.xyz')).toBe('app.getvaulted.xyz')
    expect(requireMainnetWalletRpId('rc.getvaulted.xyz')).toBe('rc.getvaulted.xyz')
    expect(isMainnetWalletOrigin('https://app.getvaulted.xyz')).toBe(true)
    expect(isMainnetWalletHost('app.getvaulted.xyz')).toBe(true)
    expect(isMainnetWalletHost('RC.GETVAULTED.XYZ:443')).toBe(true)
  })

  it('rejects Mutinynet, parent-domain, and non-canonical mainnet origins', () => {
    expect(() => requireMainnetWalletOrigin('https://getvaulted.xyz')).toThrow(/not this release/)
    expect(() => requireMainnetWalletOrigin('https://guardian.getvaulted.xyz')).toThrow(/not this release/)
    expect(() => requireMainnetWalletOrigin('https://arkade-vault-mutinynet-rc.vercel.app')).toThrow(/not this release/)
    expect(() => requireMainnetWalletOrigin('https://mutinynet.arkade.sh')).toThrow(/not this release/)
    expect(() => requireMainnetWalletOrigin('https://app.getvaulted.xyz/')).toThrow(/canonical/)
    expect(() => requireMainnetWalletOrigin('http://app.getvaulted.xyz')).toThrow(/https/)
    expect(() => requireMainnetWalletRpId('getvaulted.xyz')).toThrow(/not this release/)
    expect(isMainnetWalletOrigin('https://vault.example.com')).toBe(false)
    expect(isMainnetWalletHost('arkade-vault-mutinynet-rc.vercel.app')).toBe(false)
  })
})
