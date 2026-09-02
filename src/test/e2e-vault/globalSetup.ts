import http from 'node:http'
import { CSVMultisigTapscript } from '@arkade-os/sdk'
import { hex } from '@scure/base'
import { MUTINYNET_OPERATOR_SIGNER_PUB } from '../../lib/vault/vtxo/board'

const OPERATOR_PORT = Number(process.env.VAULT_E2E_OPERATOR_PORT || 18_888)
const OPERATOR_XONLY = MUTINYNET_OPERATOR_SIGNER_PUB.slice(2)
const OPERATOR_COMPRESSED = MUTINYNET_OPERATOR_SIGNER_PUB
const CHECKPOINT_TAPSCRIPT = hex.encode(
  CSVMultisigTapscript.encode({
    timelock: { type: 'seconds', value: 4096n },
    pubkeys: [hex.decode(OPERATOR_XONLY)],
  }).script,
)

type OperatorFixtureState = {
  available: boolean
  info: Record<string, unknown>
  requests: string[]
  vtxos: Record<string, unknown>[]
}

type EsploraFixtureState = {
  boardingAddress: string
  boardingUtxos: Record<string, unknown>[]
  savingsAddress: string
  savingsTxs: Record<string, unknown>[]
  savingsUtxos: Record<string, unknown>[]
}

const DEFAULT_INFO = {
  boardingExitDelay: '604672',
  checkpointTapscript: CHECKPOINT_TAPSCRIPT,
  deprecatedSigners: [],
  digest: 'vault-e2e',
  dust: '330',
  fees: {
    intentFee: { offchainInput: '0', offchainOutput: '0', onchainInput: '0', onchainOutput: '0' },
    txFeeRate: '0',
  },
  forfeitAddress: 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx',
  forfeitPubkey: OPERATOR_COMPRESSED,
  network: 'mutinynet',
  serviceStatus: {},
  sessionDuration: '30',
  signerPubkey: OPERATOR_COMPRESSED,
  unilateralExitDelay: '2048',
  utxoMaxAmount: '-1',
  utxoMinAmount: '330',
  version: 'vault-e2e',
  vtxoMaxAmount: '-1',
  vtxoMinAmount: '330',
}

function freshState(): OperatorFixtureState {
  return { available: true, info: { ...DEFAULT_INFO }, requests: [], vtxos: [] }
}

function readBody(request: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    request.on('error', reject)
  })
}

function json(response: http.ServerResponse, status: number, body: unknown) {
  response.writeHead(status, {
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  })
  response.end(JSON.stringify(body))
}

async function listen(server: http.Server, port: number) {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', resolve)
  })
}

export default async function globalSetup() {
  let state = freshState()
  let authorizerStatus: Record<string, unknown> | undefined
  let esplora: EsploraFixtureState | undefined
  const operator = http.createServer(async (request, response) => {
    const url = new URL(request.url || '/', 'http://127.0.0.1')
    if (url.pathname === '/__vault_e2e_authorizer') {
      if (request.method === 'POST') {
        authorizerStatus = JSON.parse((await readBody(request)) || '{}') as Record<string, unknown>
        json(response, 200, authorizerStatus)
        return
      }
      if (request.method === 'DELETE') {
        authorizerStatus = undefined
        json(response, 200, {})
        return
      }
      json(response, 405, { error: 'fixture control requires POST or DELETE' })
      return
    }
    if (url.pathname === '/__vault_e2e_esplora') {
      if (request.method === 'POST') {
        esplora = JSON.parse((await readBody(request)) || '{}') as EsploraFixtureState
        json(response, 200, esplora)
        return
      }
      json(response, 405, { error: 'fixture control requires POST' })
      return
    }
    if (url.pathname === '/__vault_e2e_operator') {
      if (request.method === 'GET') {
        json(response, 200, state)
        return
      }
      if (request.method !== 'POST') {
        json(response, 405, { error: 'fixture control requires POST' })
        return
      }
      const input = JSON.parse((await readBody(request)) || '{}') as Partial<OperatorFixtureState>
      state = {
        available: input.available !== false,
        info: { ...DEFAULT_INFO, ...(input.info || {}) },
        requests: [],
        vtxos: Array.isArray(input.vtxos) ? input.vtxos : [],
      }
      json(response, 200, state)
      return
    }
    state.requests.push(`${request.method || 'GET'} ${url.pathname}${url.search}`)
    if (!state.available) {
      json(response, 503, { error: 'Operator fixture is unavailable' })
      return
    }
    if (request.method === 'OPTIONS') {
      response.writeHead(204, {
        'Access-Control-Allow-Headers': '*',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
        'Access-Control-Allow-Origin': '*',
      })
      response.end()
      return
    }
    if (url.pathname === '/v1/info') {
      json(response, 200, state.info)
      return
    }
    if (url.pathname === '/v1/status') {
      json(
        response,
        authorizerStatus ? 200 : 503,
        authorizerStatus || { error: 'Authorizer fixture is not installed yet' },
      )
      return
    }
    if (url.pathname === '/api/blocks/tip/height') {
      response.writeHead(200, { 'Content-Type': 'text/plain' })
      response.end('1')
      return
    }
    if (url.pathname === '/api/tx' && request.method === 'POST') {
      response.writeHead(200, { 'Content-Type': 'text/plain' })
      response.end('dd'.repeat(32))
      return
    }
    if (url.pathname === '/api/fee-estimates') {
      json(response, 200, { 1: 1 })
      return
    }
    const addressUtxos = url.pathname.match(/^\/api\/address\/([^/]+)\/utxo$/)
    if (addressUtxos) {
      const address = decodeURIComponent(addressUtxos[1])
      if (address === esplora?.boardingAddress) json(response, 200, esplora.boardingUtxos)
      else if (address === esplora?.savingsAddress) json(response, 200, esplora.savingsUtxos)
      else json(response, 200, [])
      return
    }
    const addressTxs = url.pathname.match(/^\/api\/address\/([^/]+)\/txs(?:\/chain\/[^/]+)?$/)
    if (addressTxs) {
      const address = decodeURIComponent(addressTxs[1])
      json(response, 200, address === esplora?.savingsAddress ? esplora.savingsTxs : [])
      return
    }
    if (/^\/api\/tx\/[0-9a-f]+\/status$/.test(url.pathname)) {
      json(response, 200, { confirmed: false })
      return
    }
    if (/^\/api\/tx\/[0-9a-f]+\/outspends$/.test(url.pathname)) {
      json(response, 200, [])
      return
    }
    if (url.pathname === '/v1/indexer/vtxos') {
      const scripts = new Set(url.searchParams.getAll('scripts').map((script) => script.toLowerCase()))
      const outpoints = new Set(url.searchParams.getAll('outpoints').map((outpoint) => outpoint.toLowerCase()))
      const vtxos = state.vtxos.filter((vtxo) => {
        if (scripts.size > 0) return scripts.has(String(vtxo.script || '').toLowerCase())
        if (outpoints.size > 0) {
          const outpoint = vtxo.outpoint as { txid?: string; vout?: number } | undefined
          return outpoints.has(`${String(outpoint?.txid || '').toLowerCase()}:${Number(outpoint?.vout || 0)}`)
        }
        return true
      })
      json(response, 200, { page: { current: 0, next: 0, total: 1 }, vtxos })
      return
    }
    if (url.pathname === '/v1/indexer/script/subscribe') {
      json(response, 200, { subscriptionId: 'vault-e2e' })
      return
    }
    if (url.pathname === '/v1/indexer/script/unsubscribe') {
      json(response, 200, {})
      return
    }
    if (url.pathname.startsWith('/v1/indexer/script/subscription/')) {
      response.writeHead(200, {
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'Content-Type': 'text/event-stream',
      })
      response.write(': connected\n\n')
      return
    }
    json(response, 404, { error: `unhandled Operator fixture path ${url.pathname}` })
  })

  await listen(operator, OPERATOR_PORT)

  return async () => {
    operator.closeAllConnections()
    await new Promise<void>((resolve) => operator.close(() => resolve()))
  }
}
