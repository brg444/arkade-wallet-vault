import { describe, expect, it } from 'vitest'
import { FAMILY_KEYS } from './constants'
import { PROGRAM_FIXTURE_FAMILY } from './fixtures'
import { classifyScript, RouteError, selectRoute, selectScriptRoute, type CoinClass, type Intent } from './route'
import { buildVaultProgramFamily } from './trees'

function family() {
  return buildVaultProgramFamily(PROGRAM_FIXTURE_FAMILY)
}

const INTENTS: Intent[] = [
  { type: 'pay' },
  { type: 'admin' },
  { type: 'initiate', claimant: 'phone' },
  { type: 'initiate', claimant: 'hardware' },
  { type: 'initiate', claimant: 'recovery' },
  { type: 'clawback', guardian: 'phone' },
  { type: 'clawback', guardian: 'hardware' },
  { type: 'clawback', guardian: 'recovery' },
  { type: 'claim' },
  { type: 'quarantine-rotate' },
]

function allowed(coin: CoinClass, intent: Intent): boolean {
  try {
    selectRoute(coin, intent)
    return true
  } catch (err) {
    if (err instanceof RouteError) return false
    throw err
  }
}

describe('staged route table', () => {
  it('classifies every family script and nothing else', () => {
    const built = family()
    expect(classifyScript(built, built.daily.script)).toEqual({ role: 'normal', kind: 'daily' })
    expect(classifyScript(built, built.savings.script)).toEqual({ role: 'normal', kind: 'savings' })
    for (const key of FAMILY_KEYS) {
      const [kind, claimant] = key.split('-')
      expect(classifyScript(built, built.pending[key].script)).toEqual({ role: 'pending', kind, claimant })
      expect(classifyScript(built, built.quarantine[key].script)).toEqual({ role: 'quarantine', kind, claimant })
    }
    expect(classifyScript(built, '5120' + 'ab'.repeat(32))).toEqual({ role: 'unknown' })
  })

  it('Daily Normal may pay, admin, or initiate; nothing else', () => {
    const coin: CoinClass = { role: 'normal', kind: 'daily' }
    expect(selectRoute(coin, { type: 'pay' }).executor).toBe('l1RoutineCeremony')
    expect(selectRoute(coin, { type: 'admin' }).executor).toBe('l1AdminPsbt')
    expect(selectRoute(coin, { type: 'initiate', claimant: 'hardware' })).toMatchObject({
      executor: 'l1Initiate',
      purpose: 'exit',
    })
    expect(selectRoute(coin, { type: 'initiate', claimant: 'recovery' }).purpose).toBe('recover')
    expect(allowed(coin, { type: 'clawback', guardian: 'phone' })).toBe(false)
    expect(allowed(coin, { type: 'claim' })).toBe(false)
    expect(allowed(coin, { type: 'quarantine-rotate' })).toBe(false)
  })

  it('Savings Normal cannot pay; admin and initiate still work', () => {
    const coin: CoinClass = { role: 'normal', kind: 'savings' }
    expect(allowed(coin, { type: 'pay' })).toBe(false)
    expect(selectRoute(coin, { type: 'admin' }).leaf).toBe('admin')
    expect(selectRoute(coin, { type: 'initiate', claimant: 'phone' }).executor).toBe('l1Initiate')
  })

  it('Pending only clawback or claim, and never with the suspect as guardian', () => {
    const coin: CoinClass = { role: 'pending', kind: 'savings', claimant: 'hardware' }
    expect(allowed(coin, { type: 'pay' })).toBe(false)
    expect(allowed(coin, { type: 'admin' })).toBe(false)
    expect(allowed(coin, { type: 'initiate', claimant: 'hardware' })).toBe(false)
    expect(selectRoute(coin, { type: 'clawback', guardian: 'phone' }).executor).toBe('l1Clawback')
    expect(selectRoute(coin, { type: 'clawback', guardian: 'recovery' }).executor).toBe('l1Clawback')
    expect(allowed(coin, { type: 'clawback', guardian: 'hardware' })).toBe(false)
    expect(selectRoute(coin, { type: 'claim' }).executor).toBe('l1Claim')
    expect(allowed(coin, { type: 'quarantine-rotate' })).toBe(false)
  })

  it('Quarantine only rotates with the two remaining keys', () => {
    const coin: CoinClass = { role: 'quarantine', kind: 'savings', claimant: 'hardware' }
    expect(allowed(coin, { type: 'pay' })).toBe(false)
    expect(allowed(coin, { type: 'claim' })).toBe(false)
    expect(selectRoute(coin, { type: 'quarantine-rotate' }).executor).toBe('l1QuarantineAdmin')
    expect(() =>
      selectRoute(coin, { type: 'quarantine-rotate' }, { availableKeys: { phone: true, recovery: false } }),
    ).toThrow(RouteError)
  })

  it('refuses unknown scripts and missing cosigners', () => {
    expect(() => selectRoute({ role: 'unknown' }, { type: 'pay' })).toThrow(/unknown script/)
    expect(() =>
      selectRoute(
        { role: 'normal', kind: 'daily' },
        { type: 'initiate', claimant: 'phone' },
        { availableKeys: { cosigners: false } },
      ),
    ).toThrow(/cosigners/)
  })

  it('enforces Pending CSV only when chain heights are supplied', () => {
    const coin: CoinClass = { role: 'pending', kind: 'savings', claimant: 'hardware' }
    expect(selectRoute(coin, { type: 'claim' }).executor).toBe('l1Claim')
    expect(() => selectRoute(coin, { type: 'claim' }, { tipHeight: 104, confirmedHeight: 100 })).toThrow(/not mature/)
    expect(selectRoute(coin, { type: 'claim' }, { tipHeight: 105, confirmedHeight: 100 }).executor).toBe('l1Claim')
  })

  it('covers every class x intent pair', () => {
    const classes: CoinClass[] = [
      { role: 'normal', kind: 'daily' },
      { role: 'normal', kind: 'savings' },
      { role: 'pending', kind: 'daily', claimant: 'phone' },
      { role: 'pending', kind: 'savings', claimant: 'hardware' },
      { role: 'pending', kind: 'daily', claimant: 'recovery' },
      { role: 'quarantine', kind: 'daily', claimant: 'phone' },
      { role: 'quarantine', kind: 'savings', claimant: 'hardware' },
      { role: 'unknown' },
    ]
    const ok = new Set<string>()
    for (const coin of classes) {
      for (const intent of INTENTS) {
        if (allowed(coin, intent)) ok.add(`${coin.role}:${'kind' in coin ? coin.kind : ''}:${intent.type}`)
      }
    }
    expect([...ok].sort()).toEqual([
      'normal:daily:admin',
      'normal:daily:initiate',
      'normal:daily:pay',
      'normal:savings:admin',
      'normal:savings:initiate',
      'pending:daily:claim',
      'pending:daily:clawback',
      'pending:savings:claim',
      'pending:savings:clawback',
      'quarantine:daily:quarantine-rotate',
      'quarantine:savings:quarantine-rotate',
    ])
  })

  it('selectScriptRoute matches builders: initiate from Savings script, clawback from that Pending', () => {
    const built = family()
    const initiate = selectScriptRoute(built, built.savings.script, { type: 'initiate', claimant: 'hardware' })
    expect(initiate.executor).toBe('l1Initiate')
    const pending = selectScriptRoute(built, built.pending['savings-hardware'].script, {
      type: 'clawback',
      guardian: 'phone',
    })
    expect(pending.executor).toBe('l1Clawback')
    expect(() =>
      selectScriptRoute(built, built.pending['savings-hardware'].script, { type: 'clawback', guardian: 'hardware' }),
    ).toThrow(/guardian/)
  })
})
