# How we talk about Arkade Vault

We built Bitkey. This is the next product: a **vault on this phone**.
Recovery is one feature. It is not the product.

The Bitkey lesson stays: short, outcome-first, name what the user holds.
The vault lesson (Revault, Casa, Unchained) is the posture: **more than
one key, different places, a window to stop a move that shouldn’t have
started.** We do not sound like a script explainer. We do sound like
custody.

## The product in one breath

Daily spend with Face ID. Savings that need hardware too. A vault
service that helps with daily spend and cannot take Savings. Optional
recovery if you lose a key — a waiting period you can cancel. Testnet
only. Don’t send real bitcoin.

## Posture

Say this once, then get out of the way:

- The **vault** is the record. The app is how you use it.
- Daily spend is delegated. Savings is not.
- No single key should be enough to take everything today.
- If a recovery starts that wasn’t you, you can stop it in time.
- If we disappear, hardware plus this device still move Savings.
  Recovery cannot empty the vault if the service is gone.

That is collaborative custody in user words. Do not say
“collaborative custody,” “self-managed,” or “N-of-N” in the app.

## The three things the user sees

| We say        | They think of                                                               | Not                            |
| ------------- | --------------------------------------------------------------------------- | ------------------------------ |
| This device   | This phone, Face ID, daily spend                                            | App Key, passkey, PhoneRoutine |
| Hardware      | The key that moves everything                                               | External owner, HWW, WIF       |
| Vault service | Helps daily spend. Cannot take Savings.                                     | Authorizer, cosigner, Arkade   |
| Recovery      | Optional. Starts a waiting period.                                          | Hold, claimant, paper key      |
| Recovery Kit  | How you get coins out if this app is gone. Map of the vault, not your keys. | Seed, Emergency Exit Kit       |
| Spending      | What this phone can send today                                              | Operational, Daily, routine    |
| Savings       | Needs this device and hardware                                              | Admin path                     |

Two registers. **Product** uses the left column. **Spec and code** may
use the right. Don’t mix them in one sentence.

## Voice

- Outcome first. “Daily spend with Face ID.”
- “If this happens, you can…”
- Short sentences. One idea each.
- Name the thing the user holds, not the script.
- Recovery is optional and secondary. Don’t open the app with it.
- When recovery appears: **time to react**, not “break-glass drama.”
- The service is a helper with a limit, not a bank and not a ghost.
- Honest limits. Testnet. Not a seed. Kit has no secrets.

Prefer:

- “Needs hardware too.”
- “Start recovery. Cancel if it wasn’t you.”
- “The vault service cannot move Savings.”
- “A waiting period starts on a new balance. Old coins don’t age into
  a shortcut.”

Avoid sounding like a threat model or a whitepaper. Also avoid
startup softness: “secure,” “full control,” “bank-grade.”

## Never in the product

hold, clawback, claimant, Pending, Quarantine, suspect, CSV, 3-of-3,
Taproot, descriptor, authorizer, PSBT (except the hardware-sign
advanced screen), “device compromise,” “full control,” “secure
savings,” unvault, forfeit, stakeholder, manager, collaborative
custody.

## Bitkey → vault (and what we take from the others)

| Bitkey             | Arkade Vault                                    | Extra flavor (don’t print the source)      |
| ------------------ | ----------------------------------------------- | ------------------------------------------ |
| App Key            | This device                                     | Daily spend lives here                     |
| Hardware Key       | Hardware                                        | Moves Savings; required for “everything”   |
| Server Key         | Vault service (daily only)                      | Unchained: we cannot move it alone         |
| Delay + Notify     | Start recovery → wait → cancel if it wasn’t you | Revault: a window to stop a bad withdrawal |
| Cloud Recovery     | Sign in on another phone with Face ID           | Same vault, new phone                      |
| Emergency Exit Kit | Recovery Kit (map of the vault, no keys)        | Casa-like inheritance file, not a seed     |
| Security hub       | Security tab                                    | Keys and recovery, not a dashboard of fear |

Revault’s product idea we keep: **delegate the small moves; keep a
cancel path on the large ones.** We do not keep their words, watchtower
panic, or “emergency deterrent.”

## Sample lines

Welcome:

> Daily spend on this phone. Savings need hardware too.

> The vault service helps with daily spend. It cannot take Savings.

Recovery (when they open it, not before):

> If you lose a key, start recovery. A waiting period begins. Cancel it
> if it wasn’t you.

> Recovery cannot skip the wait on coins that are already sitting in
> Savings.

Kit:

> A map of your vault. It has no keys. Keep it if this phone is gone.

Testnet, always nearby:

> Testnet only. Don’t send real bitcoin.

## Live vs next

Live Mutinynet is still the simpler vault: this device + hardware, no
recovery on chain. Hardware can already move mature Savings. The app
already speaks the next product (optional recovery, waiting period you
can cancel). Don’t pretend the live signer has cut over.
