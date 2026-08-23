export function isCoarsePhone(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent || ''
  if (/iPhone|iPod|Android.+Mobile|CriOS|FxiOS|EdgiOS/i.test(ua)) return true
  if (/iPad|Android/i.test(ua)) return true
  if (/Macintosh/i.test(ua) && Number(navigator.maxTouchPoints || 0) > 1) return true
  const uaData = (navigator as Navigator & { userAgentData?: { mobile?: boolean } }).userAgentData
  return Boolean(uaData?.mobile)
}

/** Whether this browser can create the device-bound passkey required by the vault. */
export async function isPlatformPasskeyAvailable(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.credentials?.create) return false
  if (typeof PublicKeyCredential === 'undefined') return false
  const check = PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable
  if (typeof check !== 'function') return false
  try {
    return await check.call(PublicKeyCredential)
  } catch {
    return false
  }
}

export type PasskeyGetMode = 'local' | 'hybrid' | 'any'

export function passkeyTransports(mode: PasskeyGetMode | boolean = 'any'): AuthenticatorTransport[] {
  const resolved: PasskeyGetMode = mode === true ? 'local' : mode === false ? 'any' : mode
  if (resolved === 'local') return ['internal']
  if (resolved === 'hybrid') return ['hybrid']
  return ['internal', 'hybrid']
}

export function allowPasskey(id: BufferSource, mode: PasskeyGetMode | boolean = 'any'): PublicKeyCredentialDescriptor {
  return { type: 'public-key', id, transports: passkeyTransports(mode) }
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function prfExtension(salt: Uint8Array, credentialId?: Uint8Array): AuthenticationExtensionsClientInputs {
  const first = salt as BufferSource
  const evalInputs = { first }
  const prf: { eval: { first: BufferSource }; evalByCredential?: Record<string, { first: BufferSource }> } = {
    eval: evalInputs,
  }
  if (credentialId?.length) {
    prf.evalByCredential = { [bytesToBase64Url(credentialId)]: evalInputs }
  }
  return { prf } as AuthenticationExtensionsClientInputs
}

export function prfFrom(cred: PublicKeyCredential): Uint8Array | null {
  const ext = cred.getClientExtensionResults() as {
    prf?: { results?: { first?: ArrayBuffer | Uint8Array }; first?: ArrayBuffer | Uint8Array }
  }
  const first = ext?.prf?.results?.first ?? ext?.prf?.first
  if (!first) return null
  const bytes = first instanceof Uint8Array ? first : new Uint8Array(first)
  return bytes.length ? bytes : null
}

type HintedCreate = PublicKeyCredentialCreationOptions & { hints?: string[] }
type HintedGet = PublicKeyCredentialRequestOptions & { hints?: string[] }

export function passkeyCreateOptions(options: PublicKeyCredentialCreationOptions): PublicKeyCredentialCreationOptions {
  const next: HintedCreate = {
    ...options,
    authenticatorSelection: {
      residentKey: 'required',
      requireResidentKey: true,
      userVerification: 'required',
      authenticatorAttachment: 'platform',
    },
    hints: ['client-device'],
  }
  return next
}

export function passkeyGetOptions(
  options: PublicKeyCredentialRequestOptions,
  mode: PasskeyGetMode | boolean = 'any',
): PublicKeyCredentialRequestOptions {
  const resolved: PasskeyGetMode = mode === true ? 'local' : mode === false ? 'any' : mode
  const next: HintedGet = {
    ...options,
    userVerification: 'required',
    hints: resolved === 'local' ? ['client-device'] : resolved === 'hybrid' ? ['hybrid'] : ['client-device', 'hybrid'],
  }
  if (next.allowCredentials?.length) {
    next.allowCredentials = next.allowCredentials.map((cred) => ({
      ...cred,
      transports: passkeyTransports(resolved),
    }))
  }
  return next
}

export function deviceSigningOptions(
  options: Omit<PublicKeyCredentialRequestOptions, 'allowCredentials'>,
  credentialId: Uint8Array,
): PublicKeyCredentialRequestOptions {
  const mode: PasskeyGetMode = isCoarsePhone() ? 'local' : 'any'
  return passkeyGetOptions(
    {
      ...options,
      allowCredentials: [allowPasskey(credentialId, mode)],
    },
    mode,
  )
}
