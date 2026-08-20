import { DefaultVtxo, type Contract, type PathContext, type TapLeafScript } from '@arkade-os/sdk'
import { hex } from '@scure/base'
import { describe, expect, it } from 'vitest'
import pack from '../contract-pack.json'
import golden from './testdata/vault-policy-v1-tree.json'
import { VaultPolicyV1Handler } from './handler'
import {
  VAULT_POLICY_V1_ARKD_MIN_EXIT_DELAY,
  VAULT_POLICY_V1_DELEGATE_CAPABILITY,
  VAULT_POLICY_V1_DELEGATE_ORIGIN,
  VAULT_POLICY_V1_EXIT_DELAY,
  VAULT_POLICY_V1_EXIT_DELAY_UNIT,
  VAULT_POLICY_V1_PINNED_DELEGATE,
  VaultPolicyV1Script,
  pinnedDelegateXOnly,
  type VaultPolicyV1Params,
} from './script'

function xonly(hex32: string): Uint8Array {
  return hex.decode(hex32)
}

function twoGuardianParams(): VaultPolicyV1Params {
  return {
    userPub: xonly(golden.fixtures.userPub),
    vtxoVaultCosignerPub: xonly(golden.fixtures.vtxoVaultCosignerPub),
    arkdServerPub: xonly(golden.fixtures.arkdServerPub),
    delegatePub: xonly(golden.fixtures.delegatePub),
    exitDelay: VAULT_POLICY_V1_EXIT_DELAY,
    exitDelayUnit: VAULT_POLICY_V1_EXIT_DELAY_UNIT,
    exitDevicePub: xonly(golden.fixtures.exitDevicePub),
    exitHardwarePub: xonly(golden.fixtures.exitHardwarePub),
  }
}

function threeGuardianParams(): VaultPolicyV1Params {
  return {
    ...twoGuardianParams(),
    exitRecoveryPub: xonly(golden.fixtures.exitRecoveryPub),
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

  it('does not take an emulator pub in the shared golden', () => {
    expect('tweakedEmulatorPub' in golden.fixtures).toBe(false)
  })

  it('pins the 3-key collaborative forfeit leaf from the shared golden', () => {
    const script = new VaultPolicyV1Script(twoGuardianParams())
    expect(script.forfeitScript).toBe(golden.leaves.spend)
    expect(leafHex(script.forfeit())).toBe(golden.leaves.spend)
    expect(script.forfeitScript).not.toBe(script.delegateScript)
    expect(script.forfeitScript.includes('f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9')).toBe(
      false,
    )
  })

  it('pins the two-guardian exit leaf at 4608 seconds CSV', () => {
    const script = new VaultPolicyV1Script(twoGuardianParams())
    expect(script.exitScript).toBe(golden.leaves.exitTwoGuardian)
    expect(leafHex(script.exit())).toBe(golden.leaves.exitTwoGuardian)
  })

  it('pins the three-guardian exit leaf as the single exit replacement', () => {
    const script = new VaultPolicyV1Script(threeGuardianParams())
    expect(script.exitScript).toBe(golden.leaves.exitThreeGuardian)
    expect(leafHex(script.exit())).toBe(golden.leaves.exitThreeGuardian)
    expect(script.exitScript).not.toBe(golden.leaves.exitTwoGuardian)
  })

  it('pins the 4-key delegate-forfeit leaf and the shared tapkeys', () => {
    const two = new VaultPolicyV1Script(twoGuardianParams())
    expect(two.delegateScript).toBe(golden.leaves.delegate)
    expect(leafHex(two.delegate())).toBe(golden.leaves.delegate)
    expect(two.delegateScript).not.toBe(two.forfeitScript)
    expect(hex.encode(two.tweakedPublicKey)).toBe(golden.twoGuardian.tapKey)
    expect(hex.encode(two.pkScript)).toBe(golden.twoGuardian.pkScript)

    const three = new VaultPolicyV1Script(threeGuardianParams())
    expect(hex.encode(three.tweakedPublicKey)).toBe(golden.threeGuardian.tapKey)
    expect(hex.encode(three.pkScript)).toBe(golden.threeGuardian.pkScript)
  })

  it('has exactly one guardian CSV exit leaf', () => {
    const csvPrefix = '03090040b275'
    const two = new VaultPolicyV1Script(twoGuardianParams())
    const csvLeaves = [two.forfeitScript, two.exitScript, two.delegateScript].filter((leaf) =>
      leaf.startsWith(csvPrefix),
    )
    expect(csvLeaves).toEqual([two.exitScript])
    expect(two.exitScript).toBe(golden.leaves.exitTwoGuardian)

    const three = new VaultPolicyV1Script(threeGuardianParams())
    const threeCsv = [three.forfeitScript, three.exitScript, three.delegateScript].filter((leaf) =>
      leaf.startsWith(csvPrefix),
    )
    expect(threeCsv).toEqual([three.exitScript])
    expect(three.exitScript).toBe(golden.leaves.exitThreeGuardian)
  })

  it('uses the pinned public delegate x-only and refuses 2048s', () => {
    expect(hex.encode(pinnedDelegateXOnly())).toBe(golden.fixtures.delegatePub)
    expect(VAULT_POLICY_V1_PINNED_DELEGATE.endsWith(golden.fixtures.delegatePub)).toBe(true)
    expect(VAULT_POLICY_V1_ARKD_MIN_EXIT_DELAY).toBe(2048n)
    expect(() => new VaultPolicyV1Script({ ...twoGuardianParams(), exitDelay: 2048n })).toThrow(
      /4608|below the arkd minimum|frozen/,
    )
    expect(
      () => new VaultPolicyV1Script({ ...twoGuardianParams(), delegatePub: xonly(golden.fixtures.userPub) }),
    ).toThrow(/pinned public delegate/)
  })

  it('collaborative selectPath returns script.forfeit(), the 3-key spend leaf', () => {
    const script = new VaultPolicyV1Script(twoGuardianParams())
    const selected = VaultPolicyV1Handler.selectPath(script, contractOf(script), collaborativeContext())
    expect(selected).not.toBeNull()
    expect(leafHex(selected!.leaf)).toBe(golden.leaves.spend)
    expect(leafHex(selected!.leaf)).toBe(leafHex(script.forfeit()))
    expect(leafHex(selected!.leaf)).not.toBe(script.exitScript)
    expect(leafHex(selected!.leaf)).not.toBe(script.delegateScript)

    const defaultVtxo = new DefaultVtxo.Script({
      pubKey: xonly(golden.fixtures.userPub),
      serverPubKey: xonly(golden.fixtures.arkdServerPub),
    })
    expect(leafHex(selected!.leaf)).not.toBe(leafHex(defaultVtxo.forfeit()))
    expect(leafHex(selected!.leaf)).not.toBe(leafHex(defaultVtxo.exit()))

    const spendable = VaultPolicyV1Handler.getSpendablePaths(script, contractOf(script), collaborativeContext())
    expect(spendable.map((path) => leafHex(path.leaf))).toEqual([golden.leaves.spend])
  })

  it('createScript throws on DefaultVtxo-shaped params and missing pubs', () => {
    expect(() =>
      VaultPolicyV1Handler.createScript({
        pubKey: golden.fixtures.userPub,
        serverPubKey: golden.fixtures.arkdServerPub,
        csvTimelock: '144',
      }),
    ).toThrow(/DefaultVtxo|DelegateVtxo|missing pubs/)

    expect(() =>
      VaultPolicyV1Handler.createScript({
        pubKey: golden.fixtures.userPub,
        serverPubKey: golden.fixtures.arkdServerPub,
        delegatePubKey: golden.fixtures.delegatePub,
        csvTimelock: '144',
      }),
    ).toThrow(/DefaultVtxo|DelegateVtxo|missing pubs/)

    const serialized = VaultPolicyV1Handler.serializeParams(twoGuardianParams())
    const missingUser = { ...serialized }
    delete missingUser.userPub
    expect(() => VaultPolicyV1Handler.createScript(missingUser)).toThrow(/missing pubs|userPub/)

    expect(() =>
      VaultPolicyV1Handler.createScript({
        ...serialized,
        tweakedEmulatorPub: 'f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9',
      }),
    ).toThrow(/emulator pub/)
  })

  it('pins pack 3-key spend, exit.delay 4608, delegate capability, and no tunnel', () => {
    const listed = pack.programs['vault-policy-v1']
    expect(listed.template).toBe('vault-policy-v1-collaborative-3key')
    expect(listed.spend.leaf).toBe('user-and-vtxo-vault-cosigner-and-arkd')
    expect(listed.spend.note).toMatch(/VaultCosigner independently enforces the Vault Program/)
    expect(listed.exit.delay).toBe('4608')
    expect(listed.exit.delayUnit).toBe('seconds')
    expect(listed.exit.arkdMinimum).toBe('2048')
    expect(listed.delegate.leaf).toBe('user-and-vtxo-vault-cosigner-and-pinned-public-delegate-and-arkd')
    expect(listed.delegate.pinnedPublicDelegate).toBe(VAULT_POLICY_V1_PINNED_DELEGATE)
    expect(listed.delegate.origin).toBe(VAULT_POLICY_V1_DELEGATE_ORIGIN)
    expect(listed.delegate.capability).toBe(VAULT_POLICY_V1_DELEGATE_CAPABILITY)
    expect(listed.notes).toMatch(/3-key \[user, VTXO VaultCosigner, Arkade Operator\]/)
    expect(listed.notes).toMatch(/VaultCosigner independently enforces the Vault Program/)
    expect('tunnel' in listed).toBe(false)
  })
})
