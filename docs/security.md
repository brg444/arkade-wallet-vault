# Security

This is a testnet demo. It is not something you should trust with real
money.

**We do this**

- A caller cannot hand us their own signer and skip the vault’s rules
- Daily spend needs Face ID, the real transaction, and the remaining limit
- This device checks the sighash it is about to approve
- A request with no vault id cannot spend someone else’s leftover coins
- New vaults do not put the service’s master key on chain
- The curve generator is not accepted as hardware

**We do not claim this**

Real gaps, not oversights. Read each one as “the demo does not protect
you here.”

- **Root on the server.** We isolate a process. We do not claim that
  someone with root cannot reach the service key
- **A bug in this website.** XSS on this site can steal the device key
  while you are unlocked. Nothing here prevents that
- **A watchtower.** Nobody watches the 6-block hardware wait for you. If
  you are not looking, a recovery someone started can mature
- **Mainnet.** Not supported and not audited

How to tell us about a problem: [SECURITY.md](../SECURITY.md).
