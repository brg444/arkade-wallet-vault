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
    return 'The vault service is not running. Start it, then try Set up with passkey again. You can still look around first.'
  }
  if (msg.includes('authorizer status') || msg.includes('unreachable')) {
    return 'The vault service is not responding. Check that it is running, then try again.'
  }
  if (msg.includes('http://localhost:3003') && msg.includes('127.0.0.1')) {
    return 'Open this page as http://localhost:3003 — 127.0.0.1 will not work with the passkey.'
  }
  if (msg.includes('rp id') || msg.includes('origin does not match') || msg.includes('signing client')) {
    return 'This page is on a different address than the vault expects. Open http://localhost:3003 and try again.'
  }
  if (msg.includes('prf')) {
    return 'This device or browser cannot create the kind of passkey this vault needs. Try Safari or Chrome on this computer.'
  }
  if (msg.includes('not allowed') || msg.includes('abort') || msg.includes('timed out')) {
    return 'Passkey was cancelled. When you are ready, try again and approve the prompt.'
  }
  if (msg.includes('not enrolled') || msg.includes('enroll first')) {
    return 'Set up a passkey first.'
  }
  if (msg.includes('template version') || msg.includes('policy version')) {
    return 'This app does not match the vault service version. Update one of them and try again.'
  }
  if (msg.includes('invalid address') || msg.includes('not a bitcoin')) {
    return 'Enter a bitcoin address. Lightning and Ark addresses are not used here.'
  }
  if (msg.includes('exceeds transaction cap') || msg.includes('recipient exceeds')) {
    return 'That amount is above the per-payment limit.'
  }
  if (msg.includes('period allowance')) {
    return 'That would go over today’s spending limit.'
  }
  if (msg.includes('dust')) {
    return 'That amount is too small to send.'
  }
  return raw.charAt(0).toUpperCase() + raw.slice(1)
}
