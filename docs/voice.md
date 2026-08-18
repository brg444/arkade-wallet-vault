# How we talk about Arkade Vault

This is a Mutinynet custody client. It is not a campaign. Words must
match what the keys can actually do.

Split: this device, hardware, a service that cosigns daily spend only.
Recovery is optional. If you add it, it starts a **new** waiting period.
It does not unlock coins that have already aged.

## One paragraph

Daily spend: this device + vault service, under a published cap.
Savings: this device + hardware. The service cannot sign Savings.
Recovery is optional. Skip and the vault is this device plus hardware.
Add it and starting recovery creates a new output and a delay. You
can cancel during the delay. After the delay, the party who started
it can take the coins. It does not spend Savings alone while the
original output is still there. Testnet only. Do not send real bitcoin.

Live signer still mints the simpler program (no on-chain recovery).
Do not describe live funds as if the next program is already signing.

## Names

Use these in the app and in user-facing docs. Spec files may use the
implementation names; do not put those in the UI.

| Say            | Means                                                      | Do not say                     |
| -------------- | ---------------------------------------------------------- | ------------------------------ |
| This device    | The phone key used for daily spend and as one Savings key  | App Key, passkey, PhoneRoutine |
| Hardware       | Independent key required to move Savings immediately       | HWW, external owner, WIF       |
| Vault service  | Cosigner for daily spend only. Not a Savings signer        | Authorizer, server key         |
| Recovery       | Optional. Starts a delay on a **new** output. Cancelable until then | Hold, claimant, paper key |
| Recovery Kit   | Public map of addresses and trees. Contains no private keys | Seed, Emergency Exit Kit      |
| Spending       | Balance this device can spend under the cap                | Operational, Daily, routine    |
| Savings        | Balance that needs this device and hardware to move now    | Admin                          |

## Rules

1. State who must sign, and what they still cannot do.
2. State whether a delay applies to **this** output or to a new one.
3. Caps, CSV lengths, and templates are published identifiers. Do not
   paraphrase them into “secure” or “full control.”
4. Recovery is optional. Skip keeps this device plus hardware. It is
   not the first screen and not the definition of the product.
5. Limits belong next to the claim: testnet; kit has no secrets;
   service host can still lose or leak the daily cosigner.

## Screens

One job per screen. One primary button at the bottom. Security lives
on Security, not Settings. Settings is theme, about, and sign out.
Recovery is optional. Skip is the easy path when the field is empty.
The Recovery Kit is last-resort and lives under Security.

## Do not use in the product

hold, clawback, claimant, Pending, Quarantine, suspect, CSV, 3-of-3,
Taproot, descriptor, authorizer, unvault, forfeit, stakeholder,
collaborative custody, “device compromise,” “full control,” “secure
savings.” PSBT only on the hardware-sign advanced screen.

The recovery clock is not the age of the Savings UTXO. Live v4 funds
still allow hardware-after-6 on that UTXO. Say that when talking about
live coins.

## Claims you may make (only if true of that build)

| Claim                                                         | Live v4 | Next program |
| ------------------------------------------------------------- | ------- | ------------ |
| Service cannot sign Savings                                   | Yes     | Yes          |
| Daily spend needs this device and the service                 | Yes     | Yes          |
| Savings now needs this device and hardware                    | Yes     | Yes          |
| Hardware alone can take mature Savings after 6 blocks         | Yes     | No           |
| Recovery starts a new delay; cancel exists during that delay  | No      | Yes          |
| Recovery can empty Normal if the service is offline           | —       | No           |

If the row is No, do not imply Yes in copy.
