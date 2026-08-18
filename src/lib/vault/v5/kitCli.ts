import { CLAIMANTS, VAULT_KINDS, type Claimant, type VaultKind } from './constants'
import { familyFromDescriptor } from './descriptor'
import { inspectRecoveryKit, parseRecoveryKit, type RecoveryKit } from './kit'
import { buildClaimPsbt, buildClawbackPsbt, buildInitiatePsbt, inspectClaimPsbt, inspectTransitionPsbt } from './spend'

export type KitCliCommand =
  | { name: 'inspect'; kit: RecoveryKit }
  | {
      name: 'initiate'
      kit: RecoveryKit
      kind: VaultKind
      claimant: Claimant
      txid: string
      vout: number
      value: number
      fee: number
    }
  | {
      name: 'clawback'
      kit: RecoveryKit
      kind: VaultKind
      claimant: Claimant
      guardian: Claimant
      txid: string
      vout: number
      value: number
      fee: number
    }
  | {
      name: 'claim'
      kit: RecoveryKit
      kind: VaultKind
      claimant: Claimant
      dest: string
      txid: string
      vout: number
      value: number
      fee: number
    }
  | { name: 'verify'; psbtHex: string }

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`)
  if (i < 0 || i + 1 >= args.length) return undefined
  return args[i + 1]
}

function requireFlag(args: string[], name: string): string {
  const value = flag(args, name)
  if (!value) throw new Error(`--${name} required`)
  return value
}

function requireKind(args: string[]): VaultKind {
  const value = requireFlag(args, 'kind')
  if (!(VAULT_KINDS as readonly string[]).includes(value)) throw new Error('kind must be daily or savings')
  return value as VaultKind
}

function requireClaimant(args: string[], name = 'claimant'): Claimant {
  const value = requireFlag(args, name)
  if (!(CLAIMANTS as readonly string[]).includes(value)) throw new Error(`${name} must be phone, hardware, or recovery`)
  return value as Claimant
}

function requireInt(args: string[], name: string): number {
  const raw = requireFlag(args, name)
  const n = Number(raw)
  if (!Number.isInteger(n)) throw new Error(`--${name} must be an integer`)
  return n
}

export function parseKitCli(argv: string[], loadKit: (path: string) => RecoveryKit): KitCliCommand {
  const [name, file, ...rest] = argv
  if (!name) throw new Error('usage: inspect|initiate|clawback|claim|verify')
  if (name === 'verify') {
    if (!file) throw new Error('verify requires a psbt hex string or file path')
    return { name: 'verify', psbtHex: file }
  }
  if (!file) throw new Error(`${name} requires a Recovery Kit json path`)
  const kit = loadKit(file)
  if (name === 'inspect') return { name: 'inspect', kit }
  const coin = {
    txid: requireFlag(rest, 'txid'),
    vout: requireInt(rest, 'vout'),
    value: requireInt(rest, 'value'),
    fee: requireInt(rest, 'fee'),
  }
  if (name === 'initiate') {
    return { name: 'initiate', kit, kind: requireKind(rest), claimant: requireClaimant(rest), ...coin }
  }
  if (name === 'clawback') {
    return {
      name: 'clawback',
      kit,
      kind: requireKind(rest),
      claimant: requireClaimant(rest),
      guardian: requireClaimant(rest, 'guardian'),
      ...coin,
    }
  }
  if (name === 'claim') {
    return {
      name: 'claim',
      kit,
      kind: requireKind(rest),
      claimant: requireClaimant(rest),
      dest: requireFlag(rest, 'dest'),
      ...coin,
    }
  }
  throw new Error('usage: inspect|initiate|clawback|claim|verify')
}

export function runKitCli(cmd: KitCliCommand): string {
  if (cmd.name === 'inspect') {
    const report = inspectRecoveryKit(cmd.kit)
    const lines = [
      `vault ${report.vaultId}`,
      `hash ${report.hash}`,
      ...report.trees.map((tree) => {
        const extra = tree.delay ? ` csv ${tree.delay}` : tree.guardians ? ` ${tree.guardians.join('+')}` : ''
        return `${tree.role} ${tree.address}${extra}`
      }),
      ...report.warnings.map((line) => `warning ${line}`),
    ]
    return lines.join('\n')
  }
  if (cmd.name === 'verify') {
    try {
      const view = inspectTransitionPsbt(cmd.psbtHex)
      return `transition dest ${view.destScript} fee ${view.feeSats} p2a ${view.p2aSats}`
    } catch {
      const view = inspectClaimPsbt(cmd.psbtHex)
      return `claim dest ${view.destScript} fee ${view.feeSats} csv ${view.sequence}`
    }
  }
  const family = familyFromDescriptor(cmd.kit.descriptor)
  const coin = { txid: cmd.txid, vout: cmd.vout, value: cmd.value }
  if (cmd.name === 'initiate') {
    const built = buildInitiatePsbt({ family, kind: cmd.kind, claimant: cmd.claimant, coin, feeSats: cmd.fee })
    return `${built.destAddress}\n${built.psbtHex}`
  }
  if (cmd.name === 'clawback') {
    const built = buildClawbackPsbt({
      family,
      kind: cmd.kind,
      claimant: cmd.claimant,
      guardian: cmd.guardian,
      coin,
      feeSats: cmd.fee,
    })
    return `${built.destAddress}\n${built.psbtHex}`
  }
  const built = buildClaimPsbt({
    family,
    kind: cmd.kind,
    claimant: cmd.claimant,
    coin,
    destAddress: cmd.dest,
    feeSats: cmd.fee,
    network: cmd.kit.descriptor.network,
  })
  return built.psbtHex
}

export { parseRecoveryKit }
