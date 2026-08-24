import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  allowPasskey,
  bytesToBase64Url,
  deviceSigningOptions,
  isCoarsePhone,
  isPlatformPasskeyAvailable,
  passkeyCreateOptions,
  passkeyGetOptions,
  passkeyTransports,
  prfExtension,
  prfFrom,
} from './webauthn'

const original = navigator.userAgent
const originalCredentials = Object.getOwnPropertyDescriptor(navigator, 'credentials')

afterEach(() => {
  Object.defineProperty(navigator, 'userAgent', { configurable: true, value: original })
  if (originalCredentials) Object.defineProperty(navigator, 'credentials', originalCredentials)
  else Reflect.deleteProperty(navigator, 'credentials')
  vi.unstubAllGlobals()
})

function setUA(value: string) {
  Object.defineProperty(navigator, 'userAgent', { configurable: true, value })
}

describe('passkey options', () => {
  it('checks for a user-verifying authenticator before enrollment', async () => {
    Object.defineProperty(navigator, 'credentials', {
      configurable: true,
      value: { create: vi.fn() },
    })
    vi.stubGlobal('PublicKeyCredential', {
      isUserVerifyingPlatformAuthenticatorAvailable: vi.fn().mockResolvedValue(true),
    })
    expect(await isPlatformPasskeyAvailable()).toBe(true)

    vi.mocked(PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable).mockResolvedValue(false)
    expect(await isPlatformPasskeyAvailable()).toBe(false)
  })

  it('creates an on-device Face ID passkey on iPhone', () => {
    setUA('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)')
    expect(isCoarsePhone()).toBe(true)
    const created = passkeyCreateOptions({
      rp: { name: 'vault', id: 'example.test' },
      user: { id: new Uint8Array(16), name: 'vault', displayName: 'vault' },
      challenge: new Uint8Array(32),
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
    })
    expect(created.authenticatorSelection?.authenticatorAttachment).toBe('platform')
    expect((created as { hints?: string[] }).hints).toEqual(['client-device'])
  })

  it('creates a local computer passkey and keeps QR only as a later join path', () => {
    setUA('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/128.0.0.0')
    expect(isCoarsePhone()).toBe(false)
    expect(passkeyTransports()).toEqual(['internal', 'hybrid'])
    const created = passkeyCreateOptions({
      rp: { name: 'vault', id: 'example.test' },
      user: { id: new Uint8Array(16), name: 'vault', displayName: 'vault' },
      challenge: new Uint8Array(32),
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
    })
    expect(created.authenticatorSelection?.authenticatorAttachment).toBe('platform')
    expect((created as { hints?: string[] }).hints).toEqual(['client-device'])
    const got = passkeyGetOptions({
      challenge: new Uint8Array(32),
      allowCredentials: [allowPasskey(new Uint8Array(16))],
    })
    expect(got.allowCredentials?.[0].transports).toEqual(['internal', 'hybrid'])
    expect((got as { hints?: string[] }).hints).toEqual(['client-device', 'hybrid'])
    const local = passkeyGetOptions(
      { challenge: new Uint8Array(32), allowCredentials: [allowPasskey(new Uint8Array(16), 'local')] },
      'local',
    )
    expect(local.allowCredentials?.[0].transports).toEqual(['internal'])
    expect((local as { hints?: string[] }).hints).toEqual(['client-device'])
    const hybrid = passkeyGetOptions(
      { challenge: new Uint8Array(32), allowCredentials: [allowPasskey(new Uint8Array(16), 'hybrid')] },
      'hybrid',
    )
    expect(hybrid.allowCredentials?.[0].transports).toEqual(['hybrid'])
    expect((hybrid as { hints?: string[] }).hints).toEqual(['hybrid'])
  })

  it('keeps signing local on a phone and leaves cross-device signing available on desktop', () => {
    const credentialId = new Uint8Array(16)
    const request = () =>
      deviceSigningOptions(
        {
          challenge: new Uint8Array(32),
          rpId: 'example.test',
          extensions: prfExtension(new Uint8Array(32), credentialId),
        },
        credentialId,
      )

    setUA('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)')
    const phone = request()
    expect(phone.allowCredentials?.[0].transports).toEqual(['internal'])
    expect((phone as { hints?: string[] }).hints).toEqual(['client-device'])

    setUA('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/128.0.0.0')
    const desktop = request()
    expect(desktop.allowCredentials?.[0].transports).toEqual(['internal', 'hybrid'])
    expect((desktop as { hints?: string[] }).hints).toEqual(['client-device', 'hybrid'])
  })
})

describe('prf extension', () => {
  it('names the credential for Chrome evalByCredential', () => {
    const salt = new Uint8Array(32).fill(7)
    const cred = new Uint8Array([0xab, 0xcd])
    const ext = prfExtension(salt, cred) as {
      prf?: { eval?: { first?: Uint8Array }; evalByCredential?: Record<string, { first?: Uint8Array }> }
    }
    expect(ext.prf?.eval?.first).toBe(salt)
    expect(ext.prf?.evalByCredential?.[bytesToBase64Url(cred)]?.first).toBe(salt)
  })

  it('copies the browser-owned PRF result before recovery waits on the network', () => {
    const browserResult = new Uint8Array(32).fill(0x42)
    const credential = {
      getClientExtensionResults: () => ({ prf: { results: { first: browserResult } } }),
    } as unknown as PublicKeyCredential

    const owned = prfFrom(credential)
    browserResult.fill(0)

    expect(owned).toEqual(new Uint8Array(32).fill(0x42))
  })
})
