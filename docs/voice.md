# How we talk about Arkade Vault

We built Bitkey. This is the next product: a **vault on this phone**.
Recovery is one feature. It is not the product.

## The product in one breath

Daily spend with Face ID. Savings that need hardware too. A vault
service that helps with daily spend and cannot take Savings. Optional
recovery if you lose a key. Testnet only. Don’t send real bitcoin.

## The three things the user sees

| We say        | They think of                       | Not                            |
| ------------- | ----------------------------------- | ------------------------------ |
| This device   | This phone, Face ID, daily spend    | App Key, passkey, PhoneRoutine |
| Hardware      | The key that moves everything       | External owner, HWW, WIF       |
| Vault service | The company that helps daily spend  | Authorizer, cosigner, Arkade   |
| Recovery      | Optional. Starts a waiting period   | Hold, claimant, paper key      |
| Recovery Kit  | Last-resort file if the app is gone | Seed, Emergency Exit Kit       |
| Spending      | What this phone can send today      | Operational, Daily, routine    |
| Savings       | Needs hardware too                  | Admin path                     |

## Voice

- Outcome first. “Daily spend with Face ID.”
- “If this happens, you can…”
- Short sentences. One idea each.
- Name the thing the user holds, not the script.
- Recovery is optional and secondary. Don’t open the app with it.
- Honest limits. Testnet. Not a seed. Kit has no secrets.

## Never in the product

hold, clawback, claimant, Pending, Quarantine, suspect, CSV, 3-of-3,
Taproot, descriptor, authorizer, PSBT (except the hardware-sign
advanced screen), “device compromise”, “full control”, “secure savings”.

## Bitkey → Arkade Vault

| Bitkey             | Arkade Vault                                    |
| ------------------ | ----------------------------------------------- |
| App Key            | This device                                     |
| Hardware Key       | Hardware                                        |
| Server Key         | Vault service (daily only)                      |
| Delay + Notify     | Start recovery → wait → cancel if it wasn’t you |
| Cloud Recovery     | Sign in on another phone with Face ID           |
| Emergency Exit Kit | Recovery Kit (map of the vault, no keys)        |
| Security hub       | Security tab                                    |

Live Mutinynet is still the simpler vault: this device + hardware, no
recovery on chain. The app already speaks the next product. Don’t
pretend the live signer has cut over.
