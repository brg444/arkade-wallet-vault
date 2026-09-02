import { beforeEach, describe, expect, it, vi } from 'vitest'
import { consoleError, consoleLog, getLogs, redactDiagnosticText } from './logs'

describe('sanitized local diagnostics', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('redacts wallet and authentication payloads before storage or console output', () => {
    const bitcoin = `tb1q${'q'.repeat(40)}`
    const arkade = `tark1${'q'.repeat(48)}`
    const invoice = `lntb1${'q'.repeat(80)}`
    const psbt = `cHNidP8${'A'.repeat(80)}`
    const hex = 'ab'.repeat(32)
    const invite = 'invite=single-use-enrollment-value'
    const passkey = JSON.stringify({ challenge: 'challenge-value', rawId: 'passkey-payload-value' })
    const raw = [bitcoin, arkade, invoice, psbt, hex, invite, passkey]
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    consoleLog('wallet diagnostic', ...raw)
    consoleError(new Error(raw.join(' ')), 'wallet failure')

    const serialized = JSON.stringify(getLogs())
    const printed = JSON.stringify([...log.mock.calls, ...error.mock.calls])
    for (const secret of raw) {
      expect(serialized).not.toContain(secret)
      expect(printed).not.toContain(secret)
    }
    expect(serialized).toContain('[redacted')
  })

  it('redacts query tokens and secret fields without hiding ordinary context', () => {
    const safe = redactDiagnosticText(
      'GET /join?token=secret-token&next=home {"credential":"credential-value"} request failed',
    )
    expect(safe).toContain('GET /join?token=[redacted]&next=home')
    expect(safe).toContain('request failed')
    expect(safe).not.toContain('secret-token')
    expect(safe).not.toContain('credential-value')
  })
})
