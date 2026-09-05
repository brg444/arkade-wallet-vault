import { vaultCosignerClient } from './cosignerClient'

const STORAGE_KEY = 'vaulted.open-enrollment-session'
type Session = { token: string; expiresAt: string }

function usable(value: Session): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(value.token) && Date.parse(value.expiresAt) > Date.now() + 30_000
}

// Retain admission across canceled passkey prompts and reloads in this tab.
// This token permits one setup only; it is never a shared public invite.
export async function openEnrollmentToken(): Promise<string> {
  try {
    const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || 'null') as Session | null
    if (saved && usable(saved)) return saved.token
  } catch {
    // A fresh session is still available when browser storage is restricted.
  }
  const session = await vaultCosignerClient.enrollment.session()
  if (!usable(session)) throw new Error('The setup session could not be opened. Try again.')
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session))
  } catch {
    // The current ceremony can continue without persisting its admission token.
  }
  return session.token
}

export function clearOpenEnrollmentSession() {
  try {
    sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    // Enrollment has already completed; storage cleanup must not undo it.
  }
}
