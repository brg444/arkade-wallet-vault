import { isVaultConcurrencyUnavailableError } from './vtxo/lock'
import { isVtxoSameSendInProgressError } from './vtxo/spend'

export function humanizeVaultError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err || 'Something went wrong')
  const name = err instanceof Error ? err.name.toLowerCase() : ''
  const msg = raw.toLowerCase()
  if (isVaultConcurrencyUnavailableError(err)) {
    return 'This browser can’t safely coordinate wallet activity. Update it or use a supported browser.'
  }
  if (
    msg.includes('failed to fetch') ||
    msg.includes('networkerror') ||
    msg.includes('load failed') ||
    msg.includes('vault service is not running') ||
    msg.includes('request failed (5') ||
    msg.includes('authorizer status 5') ||
    msg.includes('econnrefused')
  ) {
    return 'Can’t reach the vault. Try again.'
  }
  if (msg.includes('authorizer status') || msg.includes('unreachable')) {
    return 'Vault isn’t responding. Try again.'
  }
  if (isRecoverableVaultBoardingError(err)) {
    return 'Moving received Bitcoin into Spending automatically. Keep this wallet open; approve with passkey if asked.'
  }
  if (msg.includes('vtxo spend is unresolved') || msg.includes('vtxo reservation expired')) {
    return 'This send did not finish. Refresh your balance before trying again.'
  }
  if (msg.includes('fee quote expired or changed')) {
    return 'This fee quote expired or changed. Review the send again.'
  }
  if (isVtxoSameSendInProgressError(err) || msg.includes('exact amount to this address is still in progress')) {
    return 'A send of this exact amount to this address is still in progress. You can wait, or start a new send anyway.'
  }
  if (
    msg.includes('reserved outpoint not spent by ark txid') ||
    msg.includes('vtxo finalization receipt') ||
    msg.includes('vtxo spend is still with the operator') ||
    msg.includes('did not return exactly one transaction') ||
    msg.includes('operator pending lookup')
  ) {
    return 'Your send was submitted and is still being confirmed. Refresh your balance before trying again.'
  }
  if (msg.includes('already bound to a different exact request')) {
    return 'This send is already in progress. Refresh your balance before trying again.'
  }
  if (msg.includes('mutated') && msg.includes('phone')) {
    return 'The vault rejected a changed signature. Refresh your balance before trying again.'
  }
  if (msg.includes('invalid scalar') || msg.includes('scalar: out of range')) {
    return 'Couldn’t unlock Spending. Sign in again.'
  }
  if (msg.includes('http://localhost:3003') && msg.includes('127.0.0.1')) {
    return 'Open this page as http://localhost:3003.'
  }
  if (msg.includes('rp id') || msg.includes('origin does not match') || msg.includes('signing client')) {
    return 'Wrong site. Open the Vault app from its approved address.'
  }
  if (msg.includes('passkey sign-in must first be enabled') || msg.includes('has not been enabled')) {
    return 'Enable sign-in on the original device first.'
  }
  if (
    msg.includes('passkey authentication failed') ||
    msg.includes('passkey credential does not match') ||
    msg.includes('passkey does not belong') ||
    msg.includes('selected passkey does not belong') ||
    msg.includes('passkey direct key does not match') ||
    msg.includes('phone bip340 key does not match') ||
    msg.includes('does not have the passkey')
  ) {
    return 'Wrong passkey. Use the device that created this vault. On a new device, scan the QR with that original device.'
  }
  if (msg.includes('prf authentication succeeded') && msg.includes('could not decrypt')) {
    return 'The passkey was verified, but its saved Spending key could not be unlocked. Try the same sign-in button once more. If it repeats, don’t create a new vault yet.'
  }
  if (msg.includes('prf')) {
    return 'This browser verified the passkey but didn’t get the unlock secret. That’s common over a QR. Open the vault on the device that created it — Safari on a Mac with the same iCloud account may also work.'
  }
  if (
    name === 'notsupportederror' ||
    msg.includes('not supported on this device') ||
    msg.includes('authenticator is not available') ||
    msg.includes('no available authenticator')
  ) {
    return 'This browser can’t create the device key. Open the invite in Safari or Chrome on a phone or computer with Face ID, Touch ID, or a device PIN.'
  }
  if (msg.includes('not allowed') || msg.includes('abort') || msg.includes('timed out')) {
    return 'The device key wasn’t created. Try again and approve the device prompt. If this browser can’t use your device, open the invite in Safari or Chrome.'
  }
  if (msg.includes('already set up') || msg.includes('already enrolled')) {
    return 'This vault already has a passkey. Sign in instead.'
  }
  if (msg.includes('not enrolled') || msg.includes('enroll first')) {
    return 'Create a passkey first.'
  }
  if (msg.includes('this setup skipped recovery')) {
    return 'This vault came back with recovery, but setup skipped it. Start over and add a recovery key.'
  }
  if (msg.includes('no recovery map') || msg.includes('no recovery kit yet')) {
    return 'This vault has no recovery map. Add recovery on a new vault, or get the map with your passkey.'
  }
  if (msg.includes('could not rebuild the map')) {
    return 'Could not rebuild the map. Save it while this app is open.'
  }
  if (
    msg.includes('template version') ||
    msg.includes('policy version') ||
    msg.includes('current vault program descriptor') ||
    msg.includes('tree does not match this vault')
  ) {
    return 'This app doesn’t match the vault. Update and try again.'
  }
  if (msg.includes('does not match the local pin') || msg.includes('not pinned locally')) {
    return 'This vault’s receive address no longer matches the one saved on this device. Don’t send coins until that’s fixed.'
  }
  if (msg.includes('api response too large')) {
    return 'The vault sent too much data. Try again.'
  }
  if (msg.includes('setup code required') || msg.includes('paste your setup code')) {
    return 'Paste your invite.'
  }
  if (msg.includes('invalid address') || msg.includes('not a bitcoin')) {
    return 'Enter a bitcoin address.'
  }
  if (msg.includes('exceeds transaction cap') || msg.includes('recipient exceeds')) {
    return 'Over the send limit.'
  }
  if (msg.includes('period allowance')) {
    return 'Over your rolling 24-hour limit.'
  }
  if (msg.includes('dust')) {
    return 'Too small to send.'
  }
  if (msg.includes('33-byte') || msg.includes('compressed public key') || msg.includes('secp256k1')) {
    return 'Paste a public key. It starts with 02 or 03.'
  }
  if (msg.includes('recovery must be a different')) {
    return 'Recovery must be a different key than hardware.'
  }
  if (msg.includes('different key') || msg.includes('must be different')) {
    return 'Use a different hardware key.'
  }
  return 'Something went wrong. Try again.'
}

export function isRecoverableVaultBoardingError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err || '')).toLowerCase()
  return (
    msg.includes('invalid_intent_proof') ||
    msg.includes('no matching intents found') ||
    msg.includes('not enough intent confirmations') ||
    msg.includes('eventsource') ||
    msg.includes('event stream') ||
    msg.includes('duplicated input')
  )
}
