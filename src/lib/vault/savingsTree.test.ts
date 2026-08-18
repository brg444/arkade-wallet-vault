import { describe, expect, it } from 'vitest'
import { bytesToHex } from './hex'
import {
  buildSavingsTree,
  checksigScript,
  csvChecksigScript,
  encodeScriptInt,
  xOnlyFromCompressed,
} from './savingsTree'

const PHONE = '02f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9'
const HARDWARE = '02e493dbf1c10d80f3581e4904930b1404cc6c13900ee0758474fa94abe8c4cd13'

describe('savings tree matches Go v4', () => {
  it('encodes CSV integers the way ScriptBuilder does', () => {
    expect(bytesToHex(encodeScriptInt(6))).toBe('56')
    expect(bytesToHex(encodeScriptInt(144))).toBe('029000')
  })

  it('builds the admin and delayed leaves', () => {
    const phone = xOnlyFromCompressed(PHONE)
    const hw = xOnlyFromCompressed(HARDWARE)
    expect(bytesToHex(checksigScript([phone, hw]))).toBe(
      '20f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9ad20e493dbf1c10d80f3581e4904930b1404cc6c13900ee0758474fa94abe8c4cd13ac',
    )
    expect(bytesToHex(csvChecksigScript(144, phone))).toBe(
      '029000b27520f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9ac',
    )
    expect(bytesToHex(csvChecksigScript(6, hw))).toBe(
      '56b27520e493dbf1c10d80f3581e4904930b1404cc6c13900ee0758474fa94abe8c4cd13ac',
    )
  })

  it('derives the same Mutinynet savings address as the authorizer', () => {
    const tree = buildSavingsTree({
      phonePub: PHONE,
      hardwarePub: HARDWARE,
      phoneCsvBlocks: 144,
      hardwareCsvBlocks: 6,
      network: 'mutinynet',
    })
    expect(tree.address).toBe('tb1pcre0tuf3hqgf3hcgqnl54uvjygl289jl4rcf7eumnj3ty7rra0jq558wv6')
    expect(bytesToHex(tree.script)).toBe('5120c0f2f5f131b81098df0804ff4af192223ea3965fa8f09f679b9ca2b27863ebe4')
    expect(bytesToHex(tree.admin.controlBlock)).toBe(
      'c050929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac03aeffb17d3c70a7e2fb72070dc8a32b64a4d7fb426aa1a1cefba3f203d95d292402b1dbd108d9a57536e6c4de708535419951df9e52194bd15556b1191291019',
    )
  })

  it('never puts the retired generator G on a v4 leaf', () => {
    const retired = '79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798'
    const tree = buildSavingsTree({
      phonePub: PHONE,
      hardwarePub: HARDWARE,
      phoneCsvBlocks: 144,
      hardwareCsvBlocks: 6,
      network: 'mutinynet',
    })
    const scripts = [
      bytesToHex(tree.admin.script),
      bytesToHex(tree.phoneCsv.script),
      bytesToHex(tree.hardwareCsv.script),
    ]
    for (const script of scripts) {
      expect(script).not.toContain(retired)
    }
  })
})
