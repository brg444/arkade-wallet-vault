# Vendored @arkade-os/sdk

Exact reviewed pin used by Vaulted Lightning SEND RC.

- Base: `arkade-os/ts-sdk` commit `f0fd58d5` (`codex/vault-board-v2-sdk-seam`), package version 0.4.66.
  This lineage owns Vaulted boarding (`createBoardingProgramScript`, worker-owned identity, worker stop).
- Cherry-picked from `@arkade-os/sdk@0.4.67` (`613bacbf`):
  - `packages/ts-sdk/src/script/vhtlc.ts` — ninth leaf `nonInteractiveRefund.withoutReceiver`
  - `packages/ts-sdk/src/contracts/handlers/vhtlcV2.ts` — persist `nonInteractiveRefundWithoutReceiver=1`
  - `packages/ts-sdk/src/wallet/contractSecrets.ts` — `provisionRefundKey` reuses wallet identity and returns `pkScript`/`address`

Do not replace this with published npm 0.4.67: that release does not export the Vaulted boarding seam.
Do not replace this with npm 0.4.68 / swap 0.0.11: that release refactors VHTLC to `nonInteractiveParameters`.
