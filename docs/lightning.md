# Lightning send

Outbound BOLT11 uses the published `@arkade-os/swap` package to request and
verify an Arkade-to-Lightning quote. The package decodes the invoice facts,
derives the VHTLC, checks the solver's lockup address, and registers the
contract with the official Arkade SDK before any funding transaction is built.

The Vault adapter opens a standard SDK wallet with the enrolled phone identity
and the existing per-vault SDK repositories. It changes only `getAddress()` so
the package commits every refund to the exact `vault-policy-v1` Spending
address. The adapter verifies that address against the signed enrollment
binding, advertised Spending script, network, and Operator signer. It closes
the temporary SDK wallet and repositories after the quote is persisted.

Funding remains an ordinary Vault VTXO send to the package-verified lockup
address. The Vault service applies the same per-transaction cap, rolling
allowance, fee bounds, input reservation, transaction verification, and
ambiguous-submission recovery used for every other Spending transfer. It does
not expose Lightning-specific routes or reinterpret the VHTLC.

## Durable client record

The wallet must persist these package-returned facts before funding:

- invoice and locally decoded amount, payment hash, network, and expiry;
- RFQ identifier, solver identity, and signed solver card identity;
- quote validity, refund locktime, funding amount, and corridor fee;
- lockup address, VHTLC script, and exact `vault-policy-v1` refund address;
- SDK contract-registration identity and the ordinary VTXO operation ID after
  reservation.

The invoice and quote are checked again immediately before funding. A quote
that expires before the user authorizes the ordinary VTXO reservation must be
discarded without creating a second operation. An ambiguous funding response
resumes through the existing VTXO operation and the official SDK
pending-transaction interface.

## Refunds

The initial send posture matches the current Arkade Wallet integration. The
VHTLC's noninteractive refund path uses the server, solver, and mainnet
Emulator to return value directly to `vault-policy-v1`. Package-level tests
rebuild the persisted contract and verify that this leaf contains the exact
Spending script.

The package also supports a later timelocked local refund through
`refundIfUnresolved`. That phone-key recovery is a separate resilience option.
Mainnet enablement must either wire and test it or record the accepted
server-assisted refund posture and its operational response.

## Release gate

The module is disabled unless `VITE_VAULT_LIGHTNING_SEND` is exactly `true`,
and no production UI currently consumes it. Enabling it requires all of the
following:

1. ordinary mainnet VTXO Spending is qualified against `arkade.computer`;
2. the mainnet Emulator and Vault Program pins are frozen;
3. one signed solver card, relay set, amount range, and rotation procedure are
   approved, because the public mainnet registry currently advertises no
   Lightning market;
4. quote expiry and ordinary reservation expiry are coordinated and covered by
   reload and lost-response tests;
5. a real invoice exercises pay, immediate failure refund, delayed status, and
   ambiguous funding recovery with bounded value.

Lightning receive remains a different product flow. It requires online
invoice and claim handling and is outside this release slice.
