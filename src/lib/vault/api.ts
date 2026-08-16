import { authorizerBase } from './status'

const MAX_API_RESPONSE_BYTES = 1024 * 1024

export async function vaultGet<T>(path: string): Promise<T> {
  return vaultRequest<T>(path)
}

export async function vaultPost<T>(path: string, body: unknown): Promise<T> {
  return vaultRequest<T>(path, JSON.stringify(body))
}

async function vaultRequest<T>(path: string, bodyJSON?: string): Promise<T> {
  const base = authorizerBase()
  const hasBody = bodyJSON != null
  const res = await fetch(`${base}${path}`, {
    method: hasBody ? 'POST' : 'GET',
    headers: hasBody
      ? { 'Content-Type': 'application/json', Accept: 'application/json' }
      : { Accept: 'application/json' },
    body: hasBody ? bodyJSON : undefined,
  })
  const text = await readBounded(res)
  if (!res.ok) {
    let message = text.trim()
    try {
      const data = JSON.parse(text) as { error?: string }
      if (data?.error) message = data.error
    } catch {
      // proxy/HTML bodies are not useful to show
    }
    if (!message || res.status >= 500) {
      throw new Error('vault service is not running')
    }
    throw new Error(message)
  }
  try {
    return JSON.parse(text) as T
  } catch {
    throw new Error('vault service is not running')
  }
}

async function readBounded(res: Response): Promise<string> {
  const declared = Number(res.headers.get('Content-Length'))
  if (Number.isFinite(declared) && declared > MAX_API_RESPONSE_BYTES) {
    throw new Error('API response too large')
  }
  return res.text()
}

export async function fetchDemoInfo(): Promise<{ demo?: boolean } | null> {
  try {
    return await vaultGet('/v1/demo/info')
  } catch {
    return null
  }
}
