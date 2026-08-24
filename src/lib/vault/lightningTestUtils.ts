import {
  ArkAddress,
  BITCOIN_EMULATOR_PUBKEY,
  DefaultVtxo,
  SingleKey,
  provisionRefundKey,
  type Contract,
  type CreateContractParams,
  type IWallet,
} from '@arkade-os/sdk'
import {
  InMemoryAssetSwapRepository,
  RfqSwapManager,
  lightningSendVtxoScript,
  registerLockupContract,
  unilateralClaimDelay,
  type RfqQuote,
  type SwapContractRegistry,
} from '@arkade-os/swap'
import { hex } from '@scure/base'
import { vi } from 'vitest'
import { requestVaultLightningQuote, withVaultRefundAddress, type VaultLightningSolverProfile } from './lightning'

export const MAINNET_TEST_PROFILE: VaultLightningSolverProfile = {
  network: 'bitcoin',
  pubkey: '66'.repeat(32),
  relays: ['wss://nostr.test'],
  minSats: 500,
  maxSats: 50_000,
  maxFundingSats: 100_000,
}

export const MAINNET_INVOICE =
  'lnbc21u1pnk8larsp526g88ejh9ac0es9j6juxwenzdzvs6hcrphna5pp3jefpukmtk3hqpp5m206npk0fr6k45u8f90capqw48k3pzymlqhk0j98kyx4mz383pkqdz9235x2gr3w45kx6eqvfex7amwypnx77pqdf6k6urnyphhvetjyp6xsefqd3sh57fqv3hkwxqyp2xqcqz95rzjqv9ruzr6quwpsuwmyshlvenk0xm7djrtt8ugt2ja6cx3dkqtccdgvzzxeyqq28qqqqqqqqqqqqqqq9gq2y9qyysgqvu5k5w9q0xe62envhds058r9h8v5uak09hn3uzlw39sqkcuwh34j44gc53j6x6sg0u6yf6l0durxqqekytupxpf66zc7rc9cpav72ssqpcgv3p'

export const MUTINYNET_INVOICE =
  'lntbs21u1p4ghty5pp500cgfavsavx2prgw3vm4s6ckrjvg9zyjx3k87segw240hr2l2glqdqqcqzzsxqyz5vqsp56tscwj6zyk4k9g2xm4r0tf7s6xemuq2rqm7vea0tfymmzwapaqlq9qxpqysgq49fj3f48wy2utl25xzs8tjg7ak89p3242p2h3e9rk20alxajjqarjusq8222fsa9ncy43ucslfdcdtld2pd58hcxtndmjf0sfyqsf2qpsf0h6s'
export const MUTINYNET_INVOICE_TIMESTAMP = 1_787_538_580

export const INVOICE_TIMESTAMP = 1_734_606_755
export const INVOICE_EXPIRES = INVOICE_TIMESTAMP + 43_200

export async function refundAddress(network: 'bitcoin' | 'mutinynet' = 'bitcoin') {
  const phone = SingleKey.fromPrivateKey(hex.decode('01'.padStart(64, '0')))
  const operator = SingleKey.fromPrivateKey(hex.decode('04'.padStart(64, '0')))
  const phonePub = (await phone.compressedPublicKey()).slice(1)
  const operatorPub = (await operator.compressedPublicKey()).slice(1)
  const script = new DefaultVtxo.Script({
    pubKey: phonePub,
    serverPubKey: operatorPub,
    csvTimelock: DefaultVtxo.Script.DEFAULT_TIMELOCK,
  })
  return script.address(network === 'bitcoin' ? 'ark' : 'tark', operatorPub).encode()
}

export function memoryContracts() {
  const rows = new Map<string, Contract>()
  const createContract = vi.fn(async (params: CreateContractParams) => {
    const existing = rows.get(params.script)
    if (existing) return existing
    const contract = {
      ...params,
      state: params.state ?? 'active',
      createdAt: Date.now(),
      watch: 'watched',
    } as Contract
    rows.set(contract.script, contract)
    return contract
  })
  const contracts = {
    createContract,
    getContracts: vi.fn(async (filter?: { script?: string | string[] }) => {
      const scripts = filter?.script ? (Array.isArray(filter.script) ? filter.script : [filter.script]) : undefined
      return [...rows.values()].filter((contract) => !scripts || scripts.includes(contract.script))
    }),
    onContractEvent: vi.fn(() => () => {}),
    setContractWatchState: vi.fn(async (script: string, watch: 'watched' | 'retained' | 'awaiting-funds') => {
      const contract = rows.get(script)
      if (!contract) throw new Error(`missing contract ${script}`)
      rows.set(script, { ...contract, watch } as Contract)
    }),
  } as unknown as SwapContractRegistry
  return { contracts, rows, createContract }
}

export function emptyIndexer() {
  return {
    getVtxos: vi.fn(async () => ({ vtxos: [] })),
    getVirtualTxs: vi.fn(async () => ({ txs: [] })),
  }
}

export function quoteManager(
  repository: InMemoryAssetSwapRepository,
  contracts: SwapContractRegistry,
  indexer = emptyIndexer(),
) {
  const manager = new RfqSwapManager({ repository, contracts, indexer: indexer as never })
  manager.setCallbacks({ refundArkade: vi.fn(async () => null) })
  return { manager, indexer }
}

export async function completeRequestResult(
  wallet: IWallet,
  contracts: SwapContractRegistry,
  overrides: { fundAmount?: number; validUntil?: number; refundAddress?: string; rfqId?: string } = {},
) {
  const operator = SingleKey.fromPrivateKey(hex.decode('04'.padStart(64, '0')))
  const solver = SingleKey.fromPrivateKey(hex.decode('05'.padStart(64, '0')))
  const receiver = SingleKey.fromPrivateKey(hex.decode('06'.padStart(64, '0')))
  const operatorPub = (await operator.compressedPublicKey()).slice(1)
  const solverPub = (await solver.compressedPublicKey()).slice(1)
  const receiverPub = (await receiver.compressedPublicKey()).slice(1)
  const receiverScript = new DefaultVtxo.Script({
    pubKey: receiverPub,
    serverPubKey: operatorPub,
    csvTimelock: DefaultVtxo.Script.DEFAULT_TIMELOCK,
  }).pkScript
  const secrets = await provisionRefundKey(wallet)
  const refund = overrides.refundAddress ?? (await wallet.getAddress())
  const treeParams = {
    solverPubkey: solverPub,
    refundLocktime: INVOICE_TIMESTAMP + 10_000,
    serverPubkey: operatorPub,
    paymentHash: 'da9fa986cf48f56ad387495f8e840ea9ed10889bf82f67c8a7b10d5d8a27886c',
    claimDelay: unilateralClaimDelay(605_184),
    emulatorPubkey: hex.decode(BITCOIN_EMULATOR_PUBKEY).slice(1),
    refundPkScript: ArkAddress.decode(refund).pkScript,
    senderPubkey: secrets.pubkey,
    receiverPkScript: receiverScript,
  }
  const script = lightningSendVtxoScript(treeParams)
  const address = script.address('ark', operatorPub).encode()
  await registerLockupContract(contracts, script, address)
  const rfqId = overrides.rfqId ?? 'ab'.repeat(32)
  const quote: RfqQuote = {
    v: 1,
    type: 'rfq_quote',
    rfq_id: rfqId,
    pair: 'arkade:BTC->lightning:BTC',
    amount_side: 'to',
    from_amount: overrides.fundAmount ?? 2125,
    to_amount: 2100,
    solver_pubkey: hex.encode(solverPub),
    valid_until: overrides.validUntil ?? INVOICE_TIMESTAMP + 100,
    refund_locktime: treeParams.refundLocktime,
    profile: { receiver_pk_script: hex.encode(receiverScript), lockup_address: address },
  }
  return {
    rfqId,
    quote,
    address,
    fundAmount: overrides.fundAmount ?? 2125,
    swapPkScript: script.pkScript,
    script,
    refundAddress: refund,
    senderPubkey: secrets.pubkey,
    secrets,
    treeParams,
  }
}

export async function lightningQuoteHarness(options: { validUntil?: number; rfqId?: string } = {}) {
  const vaultAddress = await refundAddress()
  const { contracts, rows } = memoryContracts()
  const repository = new InMemoryAssetSwapRepository()
  const { manager } = quoteManager(repository, contracts)
  const wallet = withVaultRefundAddress(
    {
      identity: SingleKey.fromPrivateKey(hex.decode('02'.padStart(64, '0'))),
      getAddress: async () => 'ark1wrong',
      getContractManager: async () => contracts,
    } as unknown as IWallet,
    vaultAddress,
  )
  const result = await completeRequestResult(wallet, contracts, options)
  const requester = vi.fn(async () => result)
  const request = () =>
    requestVaultLightningQuote({
      wallet,
      arkServerUrl: 'https://arkade.computer',
      invoice: MAINNET_INVOICE,
      network: 'bitcoin',
      transport: {} as never,
      repository,
      contracts,
      manager,
      profile: MAINNET_TEST_PROFILE,
      rfqId: result.rfqId,
      requester: requester as never,
      nowSeconds: INVOICE_TIMESTAMP + 1,
      enabled: true,
    })
  return { wallet, repository, contracts, rows, manager, result, requester, request }
}
