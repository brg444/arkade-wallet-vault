import { describe, expect, it } from 'vitest'
import { FAMILY_KEYS } from './constants'
import { PROGRAM_FIXTURE_FAMILY } from './fixtures'
import { classifyScript, RouteError, selectRoute, selectScriptRoute, type CoinClass } from './route'
import { buildVaultProgramFamily } from './trees'

describe('Savings route table', () => {
  const family = buildVaultProgramFamily(PROGRAM_FIXTURE_FAMILY)

  it('classifies every current tree and rejects unknown scripts', () => {
    expect(classifyScript(family, family.savings.script)).toEqual({ role: 'normal' })
    for (const key of FAMILY_KEYS) {
      const claimant = key.slice('savings-'.length)
      expect(classifyScript(family, family.pending[key].script)).toEqual({ role: 'pending', claimant })
      expect(classifyScript(family, family.quarantine[key].script)).toEqual({ role: 'quarantine', claimant })
    }
    expect(classifyScript(family, '5120' + 'ab'.repeat(32))).toEqual({ role: 'unknown' })
  })

  it('allows only admin/initiate from Normal and requires the configured signers', () => {
    const coin: CoinClass = { role: 'normal' }
    expect(selectRoute(coin, { type: 'admin' }).executor).toBe('l1AdminPsbt')
    expect(selectRoute(coin, { type: 'initiate', claimant: 'hardware' }).executor).toBe('l1Initiate')
    expect(selectRoute(coin, { type: 'initiate', claimant: 'recovery' }).purpose).toBe('recover')
    expect(() => selectRoute(coin, { type: 'claim' })).toThrow(RouteError)
    expect(() =>
      selectRoute(coin, { type: 'initiate', claimant: 'phone' }, { availableKeys: { cosigners: false } }),
    ).toThrow(/cosigners/)
  })

  it('allows Pending claim or a non-claimant guardian clawback', () => {
    const coin: CoinClass = { role: 'pending', claimant: 'hardware' }
    expect(selectRoute(coin, { type: 'clawback', guardian: 'phone' }).executor).toBe('l1Clawback')
    expect(selectRoute(coin, { type: 'clawback', guardian: 'recovery' }).executor).toBe('l1Clawback')
    expect(() => selectRoute(coin, { type: 'clawback', guardian: 'hardware' })).toThrow(/guardian/)
    expect(() => selectRoute(coin, { type: 'claim' }, { tipHeight: 104, confirmedHeight: 100 })).toThrow(/not mature/)
    expect(selectRoute(coin, { type: 'claim' }, { tipHeight: 105, confirmedHeight: 100 }).executor).toBe('l1Claim')
  })

  it('allows Quarantine rotation only with the remaining keys', () => {
    const coin: CoinClass = { role: 'quarantine', claimant: 'hardware' }
    expect(selectRoute(coin, { type: 'quarantine-rotate' }).executor).toBe('l1QuarantineAdmin')
    expect(() =>
      selectRoute(coin, { type: 'quarantine-rotate' }, { availableKeys: { phone: true, recovery: false } }),
    ).toThrow(/recovery/)
  })

  it('routes from exact tree scripts', () => {
    expect(selectScriptRoute(family, family.savings.script, { type: 'initiate', claimant: 'hardware' }).executor).toBe(
      'l1Initiate',
    )
    expect(
      selectScriptRoute(family, family.pending['savings-hardware'].script, {
        type: 'clawback',
        guardian: 'phone',
      }).executor,
    ).toBe('l1Clawback')
  })

  it('classifies and routes only existing Standard families', () => {
    const standard = buildVaultProgramFamily({ ...PROGRAM_FIXTURE_FAMILY, recoveryPub: undefined })
    expect(classifyScript(standard, standard.pending['savings-hardware'].script)).toEqual({
      role: 'pending',
      claimant: 'hardware',
    })
    expect(
      selectScriptRoute(standard, standard.pending['savings-hardware'].script, {
        type: 'clawback',
        guardian: 'phone',
      }).executor,
    ).toBe('l1Clawback')
    expect(() =>
      selectScriptRoute(standard, standard.pending['savings-hardware'].script, {
        type: 'clawback',
        guardian: 'recovery',
      }),
    ).toThrow(/guardian/)
    expect(() =>
      selectScriptRoute(standard, standard.savings.script, { type: 'initiate', claimant: 'recovery' }),
    ).toThrow(/Standard/)
    expect(
      selectScriptRoute(
        standard,
        standard.quarantine['savings-phone'].script,
        { type: 'quarantine-rotate' },
        { availableKeys: { hardware: true, recovery: false } },
      ).executor,
    ).toBe('l1QuarantineAdmin')
  })
})
