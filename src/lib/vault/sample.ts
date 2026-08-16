import {
  ABSOLUTE_FEE_CEILING_SATS,
  DEFAULT_OPERATIONAL_CSV_BLOCKS,
  DEFAULT_SAVINGS_CSV_BLOCKS,
  DUST_SATS,
  FEERATE_CEILING_SAT_PER_V,
  PERIOD_ALLOWANCE_SATS,
  POLICY_VERSION,
  TEMPLATE_VERSION,
  TX_RECIPIENT_CAP_SATS,
  VAULT_ID,
  VAULT_SCHEMA,
} from './constants'
import type { VaultPublicDescriptor } from './types'

// Deterministic UI fixture. These keys are the public regtest scalars from
// the PoC (G and 2G family) plus obviously fake scripts. Do not fund.
export function sampleDescriptor(): VaultPublicDescriptor {
  return {
    schema: VAULT_SCHEMA,
    network: 'regtest',
    vaultId: VAULT_ID,
    templateVersion: TEMPLATE_VERSION,
    policyVersion: POLICY_VERSION,
    keys: {
      phoneRoutineBip340: '02f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9',
      phoneDirectP256: '02c9afa9d845ba75166b5c215767b1d6934e50c3db36e89b127b8a622b120f6721',
      externalOwnerWallet: '02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5',
      recoveryKey: '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
      vaultCosignerBase: '022f8bde4d1a07209355b4a7250a5c5128e88b84bddc619ab7cba8d569b240efe4',
      tweakedVaultCosigner: 'c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5',
      arkadeCosignerBase: '025cbdf0646e5db4eaa398f365f2ea7a0e3d419b7e0330e39ce92bddedcac4f9bc',
      tweakedArkadeCosigner: '5cbdf0646e5db4eaa398f365f2ea7a0e3d419b7e0330e39ce92bddedcac4f9bc',
    },
    arkadeCosigner: {
      origin: 'http://emulator.local',
      version: 'ui-sample',
    },
    csv: {
      operationalBlocks: DEFAULT_OPERATIONAL_CSV_BLOCKS,
      savingsBlocks: DEFAULT_SAVINGS_CSV_BLOCKS,
    },
    policy: {
      recipientDustSats: DUST_SATS,
      recipientCapSats: TX_RECIPIENT_CAP_SATS,
      periodAllowanceSats: PERIOD_ALLOWANCE_SATS,
      absoluteFeeCapSats: ABSOLUTE_FEE_CEILING_SATS,
      feerateCapSatVb: FEERATE_CEILING_SAT_PER_V,
    },
    operational: {
      script: '5120aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      address: 'bcrt1p40xfaupmdqysq0c6m5m6q0c6m5m6q0c6m5m6q0c6m5m6q0c6m5mq7n0d2p',
    },
    savings: {
      script: '5120bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      address: 'bcrt1phcnygw2s0x83n5h0h5h0h5h0h5h0h5h0h5h0h5h0h5h0h5h0h5hq2l3k4m',
      excludesRoutineCosigners: true,
    },
  }
}
