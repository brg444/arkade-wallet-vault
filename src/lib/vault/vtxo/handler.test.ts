import { DefaultVtxo, type Contract, type PathContext, type TapLeafScript } from '@arkade-os/sdk'
import { hex } from '@scure/base'
import { describe, expect, it } from 'vitest'
import pack from '../contract-pack.json'
import { VaultPolicyV1Handler } from './handler'
import {
  OP_TUNNEL,
  TUNNEL_ARK_SCRIPT,
  VAULT_POLICY_V1_EXIT_DELAY,
  VAULT_POLICY_V1_EXIT_DELAY_UNIT,
  VaultPolicyV1Script,
  type VaultPolicyV1Params,
} from './script'

/** Fixed 32-byte x-only fixtures (secp256k1 scalars 1..8). Not random. */
const FIXTURE = {
  userPub: '79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
  vtxoVaultCosignerPub: 'c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5',
  tweakedEmulatorPub: 'f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9',
  arkdServerPub: 'e493dbf1c10d80f3581e4904930b1404cc6c13900ee0758474fa94abe8c4cd13',
  tweakedTunnelEmulatorPub: '2f8bde4d1a07209355b4a7250a5c5128e88b84bddc619ab7cba8d569b240efe4',
  exitDevicePub: 'fff97bd5755eeea420453a14355235d382f6472f8568a18b2f057a1460297556',
  exitHardwarePub: '5cbdf0646e5db4eaa398f365f2ea7a0e3d419b7e0330e39ce92bddedcac4f9bc',
  exitRecoveryPub: '2f01e5e15cca351daff3843fb70f3c2f0a1bdd05e5af888a67784ef3e10a2a01',
} as const

const GOLDEN = {
  spend:
    '2079be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798ad20c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5ad20f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9ad20e493dbf1c10d80f3581e4904930b1404cc6c13900ee0758474fa94abe8c4cd13ac',
  exitTwoGuardian:
    '03040040b27520fff97bd5755eeea420453a14355235d382f6472f8568a18b2f057a1460297556ad205cbdf0646e5db4eaa398f365f2ea7a0e3d419b7e0330e39ce92bddedcac4f9bcac',
  exitThreeGuardian:
    '03040040b275205cbdf0646e5db4eaa398f365f2ea7a0e3d419b7e0330e39ce92bddedcac4f9bcad202f01e5e15cca351daff3843fb70f3c2f0a1bdd05e5af888a67784ef3e10a2a01ac',
  tunnel:
    '202f8bde4d1a07209355b4a7250a5c5128e88b84bddc619ab7cba8d569b240efe4ad20e493dbf1c10d80f3581e4904930b1404cc6c13900ee0758474fa94abe8c4cd13ac',
} as const

function xonly(hex32: string): Uint8Array {
  return hex.decode(hex32)
}

function twoGuardianParams(): VaultPolicyV1Params {
  return {
    userPub: xonly(FIXTURE.userPub),
    vtxoVaultCosignerPub: xonly(FIXTURE.vtxoVaultCosignerPub),
    tweakedEmulatorPub: xonly(FIXTURE.tweakedEmulatorPub),
    arkdServerPub: xonly(FIXTURE.arkdServerPub),
    tweakedTunnelEmulatorPub: xonly(FIXTURE.tweakedTunnelEmulatorPub),
    exitDelay: VAULT_POLICY_V1_EXIT_DELAY,
    exitDelayUnit: VAULT_POLICY_V1_EXIT_DELAY_UNIT,
    exitDevicePub: xonly(FIXTURE.exitDevicePub),
    exitHardwarePub: xonly(FIXTURE.exitHardwarePub),
  }
}

function threeGuardianParams(): VaultPolicyV1Params {
  return {
    ...twoGuardianParams(),
    exitRecoveryPub: xonly(FIXTURE.exitRecoveryPub),
  }
}

function leafHex(leaf: TapLeafScript): string {
  return hex.encode(leaf[1].subarray(0, leaf[1].length - 1))
}

function contractOf(script: VaultPolicyV1Script): Contract {
  return {
    type: VaultPolicyV1Handler.type,
    params: VaultPolicyV1Handler.serializeParams(script.params),
    script: hex.encode(script.pkScript),
    address: '',
    state: 'active',
    createdAt: 0,
  }
}

function collaborativeContext(): PathContext {
  return { collaborative: true, currentTime: 1_700_000_000_000 }
}

describe('VaultPolicyV1Handler', () => {
  it('has type vault-policy-v1', () => {
    expect(VaultPolicyV1Handler.type).toBe('vault-policy-v1')
  })

  it('pins the 4-pub spend leaf', () => {
    const script = new VaultPolicyV1Script(twoGuardianParams())
    expect(script.spendScript).toBe(GOLDEN.spend)
    expect(leafHex(script.spend())).toBe(GOLDEN.spend)
  })

  it('pins the two-guardian exit leaf (device+hardware, 2048 seconds CSV)', () => {
    const script = new VaultPolicyV1Script(twoGuardianParams())
    expect(script.exitScript).toBe(GOLDEN.exitTwoGuardian)
    expect(leafHex(script.exit())).toBe(GOLDEN.exitTwoGuardian)
  })

  it('pins the three-guardian exit leaf (hardware+recovery)', () => {
    const script = new VaultPolicyV1Script(threeGuardianParams())
    expect(script.exitScript).toBe(GOLDEN.exitThreeGuardian)
    expect(leafHex(script.exit())).toBe(GOLDEN.exitThreeGuardian)
    expect(script.exitScript).not.toBe(GOLDEN.exitTwoGuardian)
  })

  it('pins the tunnel 2-of-2 leaf', () => {
    const script = new VaultPolicyV1Script(twoGuardianParams())
    expect(script.tunnelScript).toBe(GOLDEN.tunnel)
    expect(leafHex(script.tunnel())).toBe(GOLDEN.tunnel)
  })

  it('uses a different spend script from the tunnel script', () => {
    const script = new VaultPolicyV1Script(twoGuardianParams())
    expect(script.spendScript).not.toBe(script.tunnelScript)
    expect(hex.encode(TUNNEL_ARK_SCRIPT)).toBe('00f7')
    expect(OP_TUNNEL).toBe(0xf7)
    expect(script.spendScript).not.toBe(hex.encode(TUNNEL_ARK_SCRIPT))
  })

  it('collaborative selectPath returns the 4-pub spend leaf, never exit/tunnel/DefaultVtxo', () => {
    const script = new VaultPolicyV1Script(twoGuardianParams())
    const selected = VaultPolicyV1Handler.selectPath(script, contractOf(script), collaborativeContext())
    expect(selected).not.toBeNull()
    expect(leafHex(selected!.leaf)).toBe(GOLDEN.spend)
    expect(leafHex(selected!.leaf)).not.toBe(script.exitScript)
    expect(leafHex(selected!.leaf)).not.toBe(script.tunnelScript)

    const defaultVtxo = new DefaultVtxo.Script({
      pubKey: xonly(FIXTURE.userPub),
      serverPubKey: xonly(FIXTURE.arkdServerPub),
    })
    expect(leafHex(selected!.leaf)).not.toBe(leafHex(defaultVtxo.forfeit()))
    expect(leafHex(selected!.leaf)).not.toBe(leafHex(defaultVtxo.exit()))

    const spendable = VaultPolicyV1Handler.getSpendablePaths(script, contractOf(script), collaborativeContext())
    expect(spendable.map((path) => leafHex(path.leaf))).toEqual([GOLDEN.spend])
  })

  it('createScript throws on DefaultVtxo-shaped params and missing pubs', () => {
    expect(() =>
      VaultPolicyV1Handler.createScript({
        pubKey: FIXTURE.userPub,
        serverPubKey: FIXTURE.arkdServerPub,
        csvTimelock: '144',
      }),
    ).toThrow(/DefaultVtxo|DelegateVtxo|missing pubs/)

    expect(() =>
      VaultPolicyV1Handler.createScript({
        pubKey: FIXTURE.userPub,
        serverPubKey: FIXTURE.arkdServerPub,
        delegatePubKey: FIXTURE.tweakedTunnelEmulatorPub,
        csvTimelock: '144',
      }),
    ).toThrow(/DefaultVtxo|DelegateVtxo|missing pubs/)

    const serialized = VaultPolicyV1Handler.serializeParams(twoGuardianParams())
    const missingUser = { ...serialized }
    delete missingUser.userPub
    expect(() => VaultPolicyV1Handler.createScript(missingUser)).toThrow(/missing pubs|userPub/)
  })

  it('pins pack exit.delay 2048 and tunnel.opcode OP_TUNNEL', () => {
    const listed = pack.programs['vault-policy-v1']
    expect(listed.exit.delay).toBe('2048')
    expect(listed.exit.delayUnit).toBe('seconds')
    expect(listed.tunnel.opcode).toBe('OP_TUNNEL')
  })
})
