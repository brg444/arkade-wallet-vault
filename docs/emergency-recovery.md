# Recovery with your saved kit

Keep this guide with the **Recovery Kit.json** downloaded from Vaulted. That
file records your Savings addresses, recovery rules, protection tier, and
Spending policy. Recovery also requires access to the keys and wallet
information used by the route available to you.

## Save the information you may need

The current app downloads a public map, identified by `version: 3` in the
file. It contains no private keys or encrypted copy of your device's wallet
key. Your passkey and this file alone are insufficient to unlock that key
if both the saved browser information and the Vault service's copy are gone.

| Item | What to keep |
| --- | --- |
| Recovery Kit.json | Save a copy outside this device and keep a second durable copy. It includes your vault addresses, so keep it private for financial privacy. |
| Your passkey | Preserve access to the passkey created for the website where you enrolled. Face recognition, a fingerprint, or your device PIN approves its use. |
| Your hardware key | Keep access to the hardware wallet and its own backup. It provides the second approval for ordinary Savings transfers. |
| Your recovery key | Keep this separately if you chose Advanced. It provides an additional delayed Savings recovery route. |
| This guide and your enrollment website | Keep them with the kit so you can identify the instructions and site associated with your vault. |

A fresh download from this release contains the same kind of public map. It
does not add an independent device-key backup. After creating a different
vault, save that vault's kit too.

## If you can still open your wallet

Open **Security → Recovery Kit** to download the map or retrieve an available
copy. **Security → I lost a key** shows the recovery tools for Savings.

The current recovery screen prepares transactions for external signing and
submission. Preparing or copying a transaction leaves those steps unfinished.
The waiting period starts when the submitted recovery transaction confirms on
Bitcoin. A prepared cancellation likewise needs the required approvals and
submission before it can protect the funds.

If you have only a saved file, the kit field in this release checks its
contents. Importing that file as a wallet and restoring passkey access require
additional capabilities beyond this inspection field.

## If a device or key is unavailable

First establish which keys you can still use. Losing a phone or hardware
device can leave its key recoverable through an existing backup. Compatible
passkey sign-in may restore device access while the required wallet
information remains available.

| Keys you can still use | Savings option |
| --- | --- |
| Device key and hardware key | Approve an ordinary Savings transfer with both keys. This path has no recovery waiting period. |
| Hardware key only | Start delayed recovery with the recovery services. The hardware path waits 6 Bitcoin blocks after confirmation of the recovery transaction. |
| Device key only | Start delayed recovery with the recovery services. The device path waits 144 blocks after confirmation. |
| Separate recovery key, enrolled with Advanced | Start delayed recovery with the recovery services. This path waits 288 blocks after confirmation. |
| Neither normal key, with Standard protection | Standard has no separate recovery-key path. The public map cannot replace the missing keys. |

On mainnet, 6, 144, and 288 blocks are approximately one hour, one day, and
two days. Block times vary. Use the waiting period committed by your vault;
test-network timing differs from mainnet.

## If recovery services are unavailable

An ordinary Savings transfer remains possible with both the device and
hardware keys, using compatible signing software and Bitcoin access. The
device key must still be unlockable from the required saved wallet
information.

Starting a new delayed Savings recovery requires both recovery cosigners.
Advanced adds a recovery key, but that key alone cannot start this process
when the services are unavailable.

If recovery has already reached a pending Bitcoin output, the key that
started it can claim after the committed delay. A service-free cancellation
requires the remaining user keys specified by that recovery. Once the
claimant can spend, cancellation competes with their claim.

Spending funds and Bitcoin still arriving into Spending have separate
recovery rules. Each has its own transaction state, required keys, committed
delays, and compatible tools. The public Savings map alone is insufficient
as a complete Spending recovery backup.

The current wallet has no **Open a Recovery Kit** action on its welcome
screen. An emergency tool must explicitly support the file you saved and
the information needed to unlock your key. A public map cannot supply a
missing encrypted device-key backup, even when an external tool supports
newer backup formats.

## If you see a recovery you did not start

Check which key started it and which remaining keys can cancel it. The
wallet checks for recovery activity while it runs and when it regains focus.
Continuous monitoring and guaranteed notifications are unavailable in this
release.

Keep access to the remaining keys while reviewing your options. Preparing a
cancellation is only one step: confirm that the required transaction was
signed, submitted, and confirmed before relying on its outcome.
