import { secp256k1 } from '@noble/curves/secp256k1.js'
import { hex } from '@scure/base'
import { TEST_NETWORK, Transaction, WIF } from '@scure/btc-signer'
import { scriptHexFromAddress } from './bitcoin'
import { zeroBytes } from './ceremony/directauth.js'
import { DUST_SATS } from './constants'
import type { EnrollmentSecrets } from './enroll'
import { bytesToHex, hexToBytes } from './hex'
import { loadAddressPin, requireStatusMatchesPin } from './pin'
import { requireSavingsTreeMatchesAddress, type SavingsTreeInput } from './savingsTree'
import type { VaultStatus } from './types'
import { allowPasskey, passkeyGetOptions, prfExtension, prfFrom } from './webauthn'

const PRF_SALT = new TextEncoder().encode('arkade-2fa-vault/prf/v1')
const HKDF_INFO = new TextEncoder().encode('arkade-2fa-vault/kek/v1')
const TX_OPTS = { version: 2, allowUnknownInputs: true, allowUnknownOutputs: true } as const

export type SavingsLeaf = 'admin' | 'phoneCsv'

export interface SavingsCoin {
  txid: string
  vout: number
  value: number
  confirmedHeight?: number
}

export function treeInputFromStatus(status: VaultStatus, phonePub: string): SavingsTreeInput {
  const hardware = String(status.externalOwnerWalletPub || '').trim()
  if (!hardware) throw new Error('this vault has no hardware key')
  return {
    phonePub,
    hardwarePub: hardware,
    phoneCsvBlocks: status.operationalCsvBlocks,
    hardwareCsvBlocks: status.savingsCsvBlocks,
    network: status.network,
  }
}

export function chooseSavingsLeaf(coin: SavingsCoin, tipHeight: number, phoneCsvBlocks: number): SavingsLeaf {
  const born = Number(coin.confirmedHeight || 0)
  if (born > 0 && tipHeight >= born && tipHeight - born + 1 >= phoneCsvBlocks) return 'phoneCsv'
  return 'admin'
}

export function buildSavingsPsbt(input: {
  status: VaultStatus
  phonePub: string
  destAddress: string
  amountSats: number
  feeSats: number
  coin: SavingsCoin
  leaf: SavingsLeaf
}): string {
  const pin = loadAddressPin(localStorage, input.status.vaultId)
  if (!pin) throw new Error('deposit address is not pinned locally')
  requireStatusMatchesPin(input.status, pin)
  if (pin.savingsAddress !== input.status.savingsAddress) throw new Error('savings address pin mismatch')
  if (!Number.isInteger(input.amountSats) || input.amountSats < DUST_SATS) throw new Error('at least 330 sats')
  if (!Number.isInteger(input.feeSats) || input.feeSats < 0) throw new Error('fee required')
  const total = input.amountSats + input.feeSats
  if (input.coin.value < total) throw new Error('not enough confirmed savings')
  const change = input.coin.value - total
  if (change > 0 && change < DUST_SATS) throw new Error('leave 330 sats of change, or send the rest')

  const tree = requireSavingsTreeMatchesAddress(treeInputFromStatus(input.status, input.phonePub), pin.savingsAddress)
  const dest = hex.decode(scriptHexFromAddress(input.destAddress, input.status.network))
  const leaf = input.leaf === 'phoneCsv' ? tree.phoneCsv : tree.admin
  const tapLeafScript = tree.tapLeafScript?.find(
    (entry) => hex.encode(entry[1].slice(0, -1)) === hex.encode(leaf.script),
  )
  if (!tapLeafScript) throw new Error('admin leaf is missing from the tree')

  const tx = new Transaction(TX_OPTS)
  tx.addInput({
    txid: hex.decode(input.coin.txid),
    index: input.coin.vout,
    witnessUtxo: { script: tree.script, amount: BigInt(input.coin.value) },
    tapInternalKey: tree.tapInternalKey,
    tapLeafScript: [tapLeafScript],
    sequence: input.leaf === 'phoneCsv' ? input.status.operationalCsvBlocks : 0xffffffff,
  })
  tx.addOutput({ script: dest, amount: BigInt(input.amountSats) })
  if (change >= DUST_SATS) tx.addOutput({ script: tree.script, amount: BigInt(change) })
  return hex.encode(tx.toPSBT())
}

export async function unlockPhoneRoutine(rec: EnrollmentSecrets, status: VaultStatus): Promise<Uint8Array> {
  const rpId = String(status.rpId || '').toLowerCase()
  if (!rpId || rpId !== location.hostname.toLowerCase()) {
    throw new Error('deployment RP ID does not match this signing client host')
  }
  if (status.clientOrigin !== location.origin) {
    throw new Error('deployment origin does not match this signing client origin')
  }
  const challenge = crypto.getRandomValues(new Uint8Array(32))
  const get = (await navigator.credentials.get({
    publicKey: passkeyGetOptions({
      challenge,
      rpId,
      allowCredentials: [allowPasskey(hexToBytes(rec.credId))],
      userVerification: 'required',
      extensions: prfExtension(PRF_SALT, hexToBytes(rec.credId)),
    }),
  })) as PublicKeyCredential | null
  if (!get) throw new Error('The operation was aborted.')
  const prf = prfFrom(get)
  if (!prf || prf.length !== 32) throw new Error('authenticator did not return PRF')
  try {
    const kek = await crypto.subtle.deriveKey(
      { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: HKDF_INFO },
      await crypto.subtle.importKey('raw', prf, 'HKDF', false, ['deriveKey']),
      { name: 'AES-GCM', length: 256 },
      false,
      ['decrypt'],
    )
    return new Uint8Array(
      await crypto.subtle.decrypt({ name: 'AES-GCM', iv: hexToBytes(rec.nonce) }, kek, hexToBytes(rec.ciphertext)),
    )
  } finally {
    zeroBytes(prf)
  }
}

export function signSavingsPsbt(psbtHex: string, priv: Uint8Array): string {
  if (priv.length !== 32) throw new Error('private key must be 32 bytes')
  const tx = Transaction.fromPSBT(hex.decode(psbtHex), TX_OPTS)
  if (tx.inputsLength !== 1) throw new Error('savings spend must have one input')
  tx.sign(priv)
  return hex.encode(tx.toPSBT())
}

export function psbtHexToBase64(psbtHex: string): string {
  const bytes = hex.decode(parseIncomingPsbt(psbtHex))
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}

export function parseIncomingPsbt(raw: string): string {
  const compact = String(raw || '')
    .trim()
    .replace(/\s+/g, '')
  if (!compact) throw new Error('psbt required')
  if (/^[0-9a-fA-F]+$/.test(compact) && compact.length % 2 === 0) return compact.toLowerCase()
  try {
    const bin = atob(compact)
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return hex.encode(out)
  } catch {
    throw new Error('not a PSBT')
  }
}

export function parseHardwareSecret(raw: string): Uint8Array {
  const trimmed = raw.trim()
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) return hexToBytes(trimmed.toLowerCase())
  try {
    return WIF(TEST_NETWORK).decode(trimmed)
  } catch {
    throw new Error('paste the hardware private key as 64-char hex or WIF')
  }
}

export function hardwarePubFromSecret(priv: Uint8Array): string {
  return bytesToHex(secp256k1.getPublicKey(priv, true))
}

export function finalizeSavingsPsbt(psbtHex: string): { txHex: string; txid: string } {
  const tx = Transaction.fromPSBT(hex.decode(psbtHex), TX_OPTS)
  tx.finalize()
  const raw = tx.extract()
  return { txHex: hex.encode(raw), txid: tx.id }
}

export function inspectSavingsPsbt(psbtHex: string) {
  const tx = Transaction.fromPSBT(hex.decode(psbtHex), TX_OPTS)
  if (tx.inputsLength !== 1) throw new Error('savings spend must have one input')
  if (tx.outputsLength < 1 || tx.outputsLength > 2) throw new Error('unexpected savings outputs')
  const input = tx.getInput(0)
  const dest = tx.getOutput(0)
  if (!input.witnessUtxo || dest.amount === undefined || !dest.script) throw new Error('incomplete savings psbt')
  return {
    value: Number(input.witnessUtxo.amount),
    destAmount: Number(dest.amount),
    destScript: hex.encode(dest.script),
    sigs: (input.tapScriptSig || []).length,
    txid: hex.encode(input.txid || new Uint8Array()),
    vout: input.index ?? 0,
  }
}

export function requireSameSavingsIntent(
  unsignedHex: string,
  signedHex: string,
  destAddress: string,
  amountSats: number,
  network: string,
) {
  const before = inspectSavingsPsbt(unsignedHex)
  const after = inspectSavingsPsbt(signedHex)
  if (before.txid !== after.txid || before.vout !== after.vout) throw new Error('signed PSBT spends a different coin')
  if (before.destAmount !== after.destAmount || before.destScript !== after.destScript) {
    throw new Error('signed PSBT changed the destination')
  }
  if (after.destAmount !== amountSats) throw new Error('signed amount does not match')
  const want = scriptHexFromAddress(destAddress, network)
  if (after.destScript !== want) throw new Error('signed destination does not match')
  if (after.sigs < 1) throw new Error('hardware did not sign')
}
