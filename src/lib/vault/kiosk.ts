import { VAULT_ID } from './constants'
import type { AddressPinFields } from './pin'

// Compiled-in Mutinynet first-vault deposit identity (tb1p9llcr…).
// New tenants do not use this; they pin after enroll/recover.
// The existing funded Q can be swept and abandoned — this seed is only
// so the current kiosk QR cannot be swapped before that.
export const TRUSTED_KIOSK_PIN_FIELDS: AddressPinFields = {
  vaultId: VAULT_ID,
  operationalAddress: 'tb1p9llcrjjkzr57py6vffwveztm0hn0hezj7wzrq5mat6nh07j37g4qh8jl0l',
  operationalScript: '51202fff81ca5610e9e0934c4a5ccc897b7de6fbe452f38430537d5ea777fa51f22a',
  savingsAddress: 'tb1pphv4l43zvz9r27t807pdnaf5sg4pqz2h9y35lcesyz74waxuaf9qm0vmyr',
}
