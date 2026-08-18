# Security

This is a testnet demo. It is not something you should trust with real
money.

**We do this**

- A random caller cannot point us at a generic signer and skip the rules
- Daily spend needs Face ID, the real transaction, and the remaining limit
- The phone checks the sighash it is about to approve
- A request with no vault id cannot spend someone else’s leftover coins
- New vaults do not put the service’s master key on chain
- The curve generator is not accepted as hardware

**We do not do this**

- Root on the server cannot steal the service key — we only isolate a process
- A bug in this website cannot steal an unlocked phone key
- Someone always watching the 6-block hardware wait
- Mainnet

How to tell us about a problem: [SECURITY.md](../SECURITY.md).
