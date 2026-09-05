import type { ContractHandler } from '@arkade-os/sdk'
import { LIGHT_PROGRAM, LightScript, validateLightScriptParams, type LightScriptParams } from './contract'

// Registration belongs to the future Light activation path; no global side effect.
export const LightContractHandler: ContractHandler<LightScriptParams, LightScript> = {
  type: LIGHT_PROGRAM,
  createScript(params) {
    return new LightScript(this.deserializeParams(params))
  },
  serializeParams(params) {
    const valid = validateLightScriptParams(params)
    return { ...valid, exitDelaySeconds: String(valid.exitDelaySeconds) }
  },
  deserializeParams(params) {
    const expected = ['network', 'ownerPub', 'cosignerPub', 'operatorPub', 'exitDelaySeconds']
    if (Object.keys(params).length !== expected.length || expected.some((key) => typeof params[key] !== 'string')) {
      throw new Error('Light contract fields do not match')
    }
    if (!/^[1-9][0-9]*$/.test(params.exitDelaySeconds)) throw new Error('Light exit delay must be canonical seconds')
    return validateLightScriptParams({
      ...params,
      network: params.network as LightScriptParams['network'],
      ownerPub: params.ownerPub,
      cosignerPub: params.cosignerPub,
      operatorPub: params.operatorPub,
      exitDelaySeconds: Number(params.exitDelaySeconds),
    })
  },
  selectPath: () => null,
  getAllSpendingPaths: () => [],
  getSpendablePaths: () => [],
  isGenericallySpendable: () => false,
}
