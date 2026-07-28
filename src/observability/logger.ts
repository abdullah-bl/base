import env from '../env.js'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
}

const REDACT_KEYS = new Set([
  'cookie',
  'authorization',
  'password',
  'token',
  'secret',
  'accesstoken',
  'refreshtoken',
  'apikey',
  'admin_token',
  'x-admin-token',
])

export interface LogEntry {
  id?: string
  ts: number
  level: LogLevel
  kind: string
  message: string
  method?: string
  path?: string
  status?: number
  durationMs?: number
  requestId?: string
  userId?: string
  ip?: string
  userAgent?: string
  meta?: Record<string, unknown>
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[env.LOG_LEVEL]
}

export function redact(
  value: unknown,
  depth = 0,
): unknown {
  if (depth > 6) return '[Truncated]'
  if (value === null || value === undefined) return value
  if (typeof value !== 'object') return value
  if (Array.isArray(value)) {
    return value.map((v) => redact(v, depth + 1))
  }
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (REDACT_KEYS.has(k.toLowerCase())) {
      out[k] = '[REDACTED]'
    } else {
      out[k] = redact(v, depth + 1)
    }
  }
  return out
}

function formatPretty(entry: LogEntry): string {
  const time = new Date(entry.ts).toISOString()
  const parts = [`[${time}]`, entry.level.toUpperCase(), entry.kind, entry.message]
  if (entry.requestId) parts.push(`req=${entry.requestId}`)
  if (entry.status !== undefined) parts.push(`status=${entry.status}`)
  if (entry.durationMs !== undefined) parts.push(`${entry.durationMs}ms`)
  return parts.join(' ')
}

type LogSink = (entry: LogEntry) => void

let sink: LogSink | null = null

/** Register a sink (log bus) — called from bus.ts to avoid circular imports at module load */
export function setLogSink(fn: LogSink | null): void {
  sink = fn
}

function emit(entry: LogEntry): void {
  if (!shouldLog(entry.level)) return

  const safe: LogEntry = {
    ...entry,
    meta: entry.meta
      ? (redact(entry.meta) as Record<string, unknown>)
      : undefined,
  }

  sink?.(safe)

  const line =
    env.NODE_ENV === 'production'
      ? JSON.stringify(safe)
      : formatPretty(safe)

  if (entry.level === 'error') {
    console.error(line)
  } else if (entry.level === 'warn') {
    console.warn(line)
  } else {
    console.log(line)
  }
}

export const logger = {
  debug(kind: string, message: string, extra?: Partial<LogEntry>) {
    emit({ ts: Date.now(), level: 'debug', kind, message, ...extra })
  },
  info(kind: string, message: string, extra?: Partial<LogEntry>) {
    emit({ ts: Date.now(), level: 'info', kind, message, ...extra })
  },
  warn(kind: string, message: string, extra?: Partial<LogEntry>) {
    emit({ ts: Date.now(), level: 'warn', kind, message, ...extra })
  },
  error(kind: string, message: string, extra?: Partial<LogEntry>) {
    emit({ ts: Date.now(), level: 'error', kind, message, ...extra })
  },
  emit,
}
