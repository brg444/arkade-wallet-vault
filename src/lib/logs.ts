import { extractError } from './error'

enum LogLevel {
  Log = 'log',
  Error = 'error',
}

export type LogLine = {
  msg: string
  time: string
  level: string
}

const itemName = 'logs'
const MAX_LOGS = 200 // around 250 bytes per log * 200 = 50KB at most

const SECRET_FIELD =
  /("(?:authenticatorData|challenge|clientDataJSON|credential|invite|passkey|phoneSecret|privateKey|psbt|rawId|secret|signature|token|userHandle)"\s*:\s*")[^"]*(")/gi
const QUERY_SECRET = /([?&](?:challenge|code|credential|invite|secret|token)=)[^&#\s]+/gi
const NAMED_SECRET = /\b(invite|passkey|psbt|secret|token)\s*[:=]\s*[^\s,;&}"'}]+/gi
const LIGHTNING_INVOICE = /\b(?:lightning:)?ln(?:bc|tb|bcrt|sb)[0-9a-z]{20,}\b/gi
const SEGWIT_ADDRESS = /\b(?:bc1|tb1|bcrt1|tark1|ark1)[a-z0-9]{12,}\b/gi
const BASE58_ADDRESS = /\b[123mn2][a-km-zA-HJ-NP-Z1-9]{25,62}\b/g
const LONG_HEX = /\b(?:0x)?[0-9a-f]{48,}\b/gi
const PSBT_BASE64 = /\bcHNidP[0-9A-Za-z+/_=-]{16,}\b/g
const BASE64_BLOB = /\b[A-Za-z0-9+/_-]{64,}={0,2}\b/g

export function redactDiagnosticText(value: string): string {
  return String(value)
    .replace(SECRET_FIELD, '$1[redacted]$2')
    .replace(QUERY_SECRET, '$1[redacted]')
    .replace(NAMED_SECRET, (_match, name: string) => `${name}=[redacted]`)
    .replace(LIGHTNING_INVOICE, '[redacted lightning invoice]')
    .replace(SEGWIT_ADDRESS, '[redacted address]')
    .replace(BASE58_ADDRESS, '[redacted address]')
    .replace(PSBT_BASE64, '[redacted PSBT]')
    .replace(LONG_HEX, '[redacted hex]')
    .replace(BASE64_BLOB, '[redacted payload]')
}

function diagnosticArg(value: unknown): string {
  if (typeof value === 'string') return redactDiagnosticText(value)
  if (value instanceof Error) return redactDiagnosticText(extractError(value))
  try {
    return redactDiagnosticText(JSON.stringify(value))
  } catch {
    return '[unserializable diagnostic]'
  }
}

export const getLogs = (): LogLine[] => {
  try {
    const logs = JSON.parse(localStorage.getItem(itemName) ?? '[]') as unknown
    return Array.isArray(logs) ? (logs as LogLine[]) : []
  } catch {
    return []
  }
}

export const getInfoLogs = (): LogLine[] => getLogs().filter((l) => l.level === 'info')

export const clearLogs = () => localStorage.removeItem(itemName)

const addLog = (level: LogLevel, args: unknown[]) => {
  const logs = getLogs()
  logs.push({
    level,
    msg: args.map(diagnosticArg).join(' '),
    time: new Date().toString(),
  })

  // Remove oldest logs if we exceed the limit
  if (logs.length > MAX_LOGS) {
    logs.splice(0, logs.length - MAX_LOGS)
  }

  try {
    localStorage.setItem(itemName, JSON.stringify(logs))
  } catch {
    // Diagnostics must never interrupt a wallet action.
  }
}

export const consoleLog = (...args: unknown[]) => {
  const safe = args.map(diagnosticArg)
  addLog(LogLevel.Log, safe)
  console.log(...safe)
}

export const consoleError = (err: unknown, msg = '') => {
  const str = redactDiagnosticText((msg ? `${msg}: ` : '') + extractError(err))
  addLog(LogLevel.Error, [str])
  console.error(str)
}

export function createIncidentReference(): string {
  try {
    return `VLT-${crypto.randomUUID().slice(0, 8).toUpperCase()}`
  } catch {
    return `VLT-${Date.now().toString(36).toUpperCase()}`
  }
}

export function recordVaultIncident(reference: string, error: unknown): void {
  consoleError(error, `Vault render failure ${reference}`)
}

export const getInfoLogsLength = () => getInfoLogs().length

export const getInfoLogLineMsg = (index: number) => getInfoLogs()[index].msg
