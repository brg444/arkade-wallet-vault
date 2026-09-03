import { readBounded } from './bounded'
import { authorizerBase } from './status'

export { MAX_API_RESPONSE_BYTES, readBounded } from './bounded'

// Exact structured error emitted by application-level /v1 failures. Gateway
// and mutation-boundary failures may remain plain text or omit code.
export interface VaultErrorResponse {
  error: string
  code: string
}

export class VaultRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code = '',
  ) {
    super(message)
    this.name = 'VaultRequestError'
  }
}

export async function vaultGet<T>(path: string, extraHeaders: Record<string, string> = {}): Promise<T> {
  return vaultRequest<T>(path, undefined, extraHeaders)
}

export async function vaultPost<T>(path: string, body: unknown, extraHeaders: Record<string, string> = {}): Promise<T> {
  return vaultRequest<T>(path, JSON.stringify(body), extraHeaders)
}

async function vaultRequest<T>(path: string, bodyJSON?: string, extraHeaders: Record<string, string> = {}): Promise<T> {
  const base = authorizerBase()
  const hasBody = bodyJSON != null
  const res = await fetch(`${base}${path}`, {
    method: hasBody ? 'POST' : 'GET',
    headers: hasBody
      ? { 'Content-Type': 'application/json', Accept: 'application/json', ...extraHeaders }
      : { Accept: 'application/json', ...extraHeaders },
    body: hasBody ? bodyJSON : undefined,
  })
  const text = await readBounded(res)
  if (!res.ok) {
    let message = text.trim()
    let code = ''
    try {
      const data = JSON.parse(text) as Partial<VaultErrorResponse>
      if (data?.error) message = data.error
      if (data?.code) code = data.code
    } catch {
      // proxy/HTML bodies are not useful to show
    }
    if (!message || res.status >= 500) {
      throw new VaultRequestError('vault service is not running', res.status, code)
    }
    throw new VaultRequestError(message, res.status, code)
  }
  try {
    return JSON.parse(text) as T
  } catch {
    throw new Error('vault service is not running')
  }
}
