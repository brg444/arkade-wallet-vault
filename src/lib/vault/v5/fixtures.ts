import { secp256k1 } from '@noble/curves/secp256k1.js'
import { hex } from '@scure/base'
import type { InitiateTweaks } from './trees'

export function compressedFromScalar(n: number): string {
  if (!Number.isInteger(n) || n < 1 || n > 255) throw new Error('scalar out of range')
  const secret = new Uint8Array(32)
  secret[31] = n
  return hex.encode(secp256k1.getPublicKey(secret, true))
}

export function scalarSecret(n: number): Uint8Array {
  if (!Number.isInteger(n) || n < 1 || n > 255) throw new Error('scalar out of range')
  const secret = new Uint8Array(32)
  secret[31] = n
  return secret
}

function pair(vault: number, arkade: number) {
  return { vault: compressedFromScalar(vault), arkade: compressedFromScalar(arkade) }
}

/** NIST P-256 sample from the v4 UI fixture. Not a secp256k1 key. */
export const FIXTURE_PHONE_DIRECT_P256 = '02c9afa9d845ba75166b5c215767b1d6934e50c3db36e89b127b8a622b120f6721'

export const V5_FIXTURE = {
  vaultId: 'aabbccddeeff00112233445566778899',
  network: 'mutinynet' as const,
  phonePub: compressedFromScalar(3),
  hardwarePub: compressedFromScalar(4),
  recoveryPub: compressedFromScalar(5),
  phoneDirectP256: FIXTURE_PHONE_DIRECT_P256,
  vaultCosignerBase: compressedFromScalar(14),
  arkadeCosignerBase: compressedFromScalar(15),
  routineVault: compressedFromScalar(6),
  routineArkade: compressedFromScalar(7),
  initiate: {
    phone: pair(8, 9),
    hardware: pair(10, 11),
    recovery: pair(12, 13),
  } satisfies InitiateTweaks,
  pending: {
    phone: pair(16, 17),
    hardware: pair(18, 19),
    recovery: pair(20, 21),
  } satisfies InitiateTweaks,
  arkadeCosigner: {
    origin: 'http://emulator.local',
    version: 'v5-fixture',
  },
}

export const V5_FIXTURE_FAMILY = {
  vaultId: V5_FIXTURE.vaultId,
  phonePub: V5_FIXTURE.phonePub,
  hardwarePub: V5_FIXTURE.hardwarePub,
  recoveryPub: V5_FIXTURE.recoveryPub,
  routineVault: V5_FIXTURE.routineVault,
  routineArkade: V5_FIXTURE.routineArkade,
  initiate: V5_FIXTURE.initiate,
  pending: V5_FIXTURE.pending,
  network: V5_FIXTURE.network,
}
