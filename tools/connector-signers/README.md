# Electrum connector qualification

Unmodified Electrum 4.8.1 signs the connector Savings PSBT with a native SegWit
software wallet. Eight tests cover native Electrum seed derivation and imported
BIP84 derivation, Standard and Advanced contracts, and partial and complete
withdrawals. The actual Electrum wallet recognizes its input, preserves the
finalized Savings witness, and signs without bypassing its warning checks.
Vaulted verifies the returned PSBT and completed transaction independently.

Electrum requires an explicit empty final scriptSig alongside the final witness
to recognize a foreign SegWit input as complete. The export preserves that
field even though the transaction library normally omits it. Enrollment also
accepts Electrum's native `m/0'/change/index` origin alongside BIP84 origins.
The public key, connector script, fingerprint, and complete path remain bound
by the enrollment commitment. Standard BIP84/BIP86 network checks still apply
when those derivation schemes are selected.

The test environment uses release commit
`1bfee7d1956ccb31778c76955683b789d1585d0c` from
[Electrum](https://github.com/spesmilo/electrum/tree/4.8.1). Install that source
with its dependencies, including a supported cryptography backend, in a
separate Python environment. After installing this repository's dependencies,
run with Node 24.15 or newer:

```sh
CONNECTOR_ELECTRUM_PYTHON=/absolute/path/to/environment/bin/python \
  node --test tools/connector-signers/electrum.qualification.mjs
```

The Python process uses temporary wallet state and public test keys. The native
seed fixture comes from Electrum's own `tests/test_wallet_vertical.py`.
No daemon, network service, existing wallet, or user secret is used. Assertions
verify the destination strings consumed by Electrum's transaction UI; desktop
screen rendering and the complete manual import/export flow remain untested.
Sparrow qualification is separate, and BlueWallet-specific changes are outside
the current scope.

Once the connector flow is enabled, the intended desktop workflow is to load
the exported PSBT through Electrum's transaction loader, review the full
destination and amount, sign, and return the signed transaction to Vaulted.
The signer must own the funded connector input. The current RC still uses the
existing Savings contract; connector enrollment, coordination, and migration
remain integration work before users can follow that flow with RC funds.
