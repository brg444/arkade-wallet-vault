import { ABSOLUTE_FEE_CEILING_SATS, FEERATE_CEILING_SAT_PER_V } from './constants'
import { fetchFeeEstimates } from './esplora'
import { WITNESS_BYTES_431 } from './program/constants'
import { estimateTransitionVbytes } from './program/spend'

/** Half-hour confirmation target. Operational fee, not the enrolled ceiling. */
export const ONCHAIN_FEE_TARGET_BLOCKS = 3

/** Conservative 1-in 3-out Savings transition including emulator packet. */
export const SAVINGS_TRANSITION_VBYTES = estimateTransitionVbytes(280, WITNESS_BYTES_431)

/** Conservative 1-in 1-out claim or guardian-exit. */
export const SAVINGS_CLAIM_VBYTES = estimateTransitionVbytes(140, 200)

export function satPerVFromFeeEstimates(
  estimates: Record<string, number>,
  targetBlocks = ONCHAIN_FEE_TARGET_BLOCKS,
): number {
  const keys = Object.keys(estimates)
    .map((key) => Number(key))
    .filter((key) => Number.isInteger(key) && key > 0)
    .sort((a, b) => a - b)
  if (keys.length === 0) throw new Error('fee estimates are missing')
  const chosen = keys.find((key) => key >= targetBlocks) ?? keys[keys.length - 1]
  const satPerV = Number(estimates[String(chosen)])
  if (!Number.isFinite(satPerV) || satPerV <= 0) throw new Error('fee estimates are invalid')
  return satPerV
}

export function operationalOnchainFeeSats(input: {
  vbytes: number
  satPerV: number
  feerateCapSatPerV?: number
  absoluteFeeCapSats?: number
}): number {
  if (!Number.isInteger(input.vbytes) || input.vbytes <= 0) throw new Error('vbytes required')
  if (!Number.isFinite(input.satPerV) || input.satPerV <= 0) throw new Error('feerate required')
  const feerateCap = input.feerateCapSatPerV ?? FEERATE_CEILING_SAT_PER_V
  const absoluteCap = input.absoluteFeeCapSats ?? ABSOLUTE_FEE_CEILING_SATS
  if (!Number.isInteger(feerateCap) || feerateCap < 1) throw new Error('feerate cap required')
  if (!Number.isInteger(absoluteCap) || absoluteCap < 0) throw new Error('absolute fee cap required')
  const satPerV = Math.max(1, Math.min(feerateCap, Math.ceil(input.satPerV)))
  const fee = Math.min(absoluteCap, satPerV * input.vbytes)
  if (!Number.isSafeInteger(fee) || fee < 1) throw new Error('operational fee is invalid')
  return fee
}

export async function recoveryOnchainFeeSats(vbytes: number): Promise<number> {
  let estimates: Record<string, number>
  try {
    estimates = await fetchFeeEstimates()
    satPerVFromFeeEstimates(estimates)
  } catch {
    // Preserve the existing recovery fee when the optional estimate is unavailable.
    return operationalOnchainFeeSats({ vbytes, satPerV: 500 / vbytes, absoluteFeeCapSats: 500 })
  }
  return operationalOnchainFeeSats({
    vbytes,
    satPerV: satPerVFromFeeEstimates(estimates),
  })
}
