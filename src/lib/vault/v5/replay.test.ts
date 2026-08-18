import { describe, expect, it } from 'vitest'
import { V5_FIXTURE, V5_FIXTURE_FAMILY } from './fixtures'
import { ReplayRefuse, applyReplay, decideReplay, memoryReplayStore, sessionKey } from './replay'
import { buildInitiatePsbt, bumpTransitionFee, inspectTransitionPsbt } from './spend'
import { buildV5Family } from './trees'

const vaultId = V5_FIXTURE.vaultId
const coin = { txid: '11'.repeat(32), vout: 0, value: 50_000 }

describe('v5 sign-once replay oracle', () => {
  it('signs the first dest, re-signs a fee bump, refuses a second dest', () => {
    const family = buildV5Family(V5_FIXTURE_FAMILY)
    const first = buildInitiatePsbt({ family, kind: 'savings', claimant: 'hardware', coin, feeSats: 500 })
    const view = inspectTransitionPsbt(first.psbtHex)
    const store = memoryReplayStore()
    const req = {
      vaultId,
      purpose: 'initiate' as const,
      inputTxid: view.inputTxid,
      inputVout: view.inputVout,
      destScriptHex: view.destScript,
      sighash: 'aa'.repeat(32),
    }
    expect(applyReplay(store, req).action).toBe('sign')
    expect(applyReplay(store, { ...req, sighash: 'bb'.repeat(32) }).action).toBe('resign')
    expect(applyReplay(store, { ...req, sighash: 'aa'.repeat(32), signature: 'cc'.repeat(64) }).action).toBe('resign')
    expect(applyReplay(store, { ...req, sighash: 'aa'.repeat(32), signature: 'cc'.repeat(64) }).action).toBe('replay')
    expect(() => applyReplay(store, { ...req, destScriptHex: '5120' + 'bb'.repeat(32) })).toThrow(ReplayRefuse)
  })

  it('never records a claim and refuses an overlapping input', () => {
    expect(() =>
      decideReplay(undefined, {
        vaultId,
        purpose: 'claim' as never,
        inputTxid: '11'.repeat(32),
        inputVout: 0,
        destScriptHex: '5120aa',
      }),
    ).toThrow(/initiate or clawback/)
    const existing = {
      vaultId,
      purpose: 'clawback' as const,
      inputTxid: '11'.repeat(32),
      inputVout: 0,
      destScriptHex: '5120aa',
    }
    expect(() => decideReplay(existing, { ...existing, inputTxid: '22'.repeat(32), destScriptHex: '5120aa' })).toThrow(
      /overlapping input/,
    )
    expect(sessionKey(vaultId, '11'.repeat(32), 0, 'initiate')).toContain('/initiate')
  })

  it('bumps fee without changing dest or input', () => {
    const family = buildV5Family(V5_FIXTURE_FAMILY)
    const first = buildInitiatePsbt({ family, kind: 'savings', claimant: 'hardware', coin, feeSats: 500 })
    const bumped = bumpTransitionFee(first.psbtHex, 800)
    const a = inspectTransitionPsbt(first.psbtHex)
    const b = inspectTransitionPsbt(bumped)
    expect(b.feeSats).toBe(800)
    expect(b.destScript).toBe(a.destScript)
    expect(b.inputTxid).toBe(a.inputTxid)
    expect(b.inputVout).toBe(a.inputVout)
    expect(() => bumpTransitionFee(first.psbtHex, 500)).toThrow(/increase/)
  })
})
