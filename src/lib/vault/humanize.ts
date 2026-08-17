export function humanizeVaultError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err || 'Something went wrong')
  const msg = raw.toLowerCase()
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
  if (msg.includes('http://localhost:3003') && msg.includes('127.0.0.1')) {
    return 'Open this page as http://localhost:3003.'
  }
  if (msg.includes('rp id') || msg.includes('origin does not match') || msg.includes('signing client')) {
    return 'Wrong site. Open arkade-vault-demo.vercel.app.'
  }
  if (msg.includes('passkey sign-in must first be enabled') || msg.includes('has not been enabled')) {
    return 'Enable sign-in on the original device first.'
  }
  if (
    msg.includes('passkey authentication failed') ||
    msg.includes('does not belong') ||
    msg.includes('does not match this vault') ||
    msg.includes('does not have the passkey')
  ) {
    return 'Wrong passkey. Use the phone or computer that created this vault. On a new phone, scan the QR with that original device.'
  }
  if (msg.includes('prf')) {
    return 'Chrome on this computer verified the passkey but did not get the unlock secret. That is common over a QR. Open the vault on the iPhone that created it. Safari on a Mac with the same iCloud account may work; Chrome usually will not.'
  }
  if (msg.includes('not allowed') || msg.includes('abort') || msg.includes('timed out')) {
    return 'Passkey cancelled.'
  }
  if (msg.includes('already set up') || msg.includes('already enrolled')) {
    return 'This vault already has a passkey. Sign in instead.'
  }
  if (msg.includes('not enrolled') || msg.includes('enroll first')) {
    return 'Create a passkey first.'
  }
  if (msg.includes('template version') || msg.includes('policy version')) {
    return 'This app doesn’t match the vault. Update and try again.'
  }
  if (msg.includes('does not match the local pin') || msg.includes('not pinned locally')) {
    return 'This vault’s deposit address no longer matches the one saved on this device. Do not send coins until that is fixed.'
  }
  if (msg.includes('api response too large')) {
    return 'The vault sent too much data. Try again.'
  }
  if (msg.includes('setup code required') || msg.includes('paste your setup code')) {
    return 'Paste your invite.'
  }
  if (msg.includes('owner and recovery signatures') || msg.includes('64-byte bip340')) {
    return 'Sign once with hardware and recovery, then paste those signatures — not the keys.'
  }
  if (msg.includes('invalid address') || msg.includes('not a bitcoin')) {
    return 'Enter a bitcoin address.'
  }
  if (msg.includes('exceeds transaction cap') || msg.includes('recipient exceeds')) {
    return 'Over the send limit.'
  }
  if (msg.includes('period allowance')) {
    return 'Over today’s limit.'
  }
  if (msg.includes('dust')) {
    return 'Too small to send.'
  }
  if (msg.includes('33-byte') || msg.includes('compressed public key') || msg.includes('secp256k1')) {
    return 'Paste a public key. It starts with 02 or 03.'
  }
  if (msg.includes('different key') || msg.includes('must be different')) {
    return 'Hardware and recovery must be different keys.'
  }
  return raw.charAt(0).toUpperCase() + raw.slice(1)
}
