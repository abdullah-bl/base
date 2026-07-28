import { ulid } from 'ulid'
import env from '../env.js'
import { getClient } from '../db/client.js'
import { logger, setLogSink, type LogEntry } from './logger.js'

export interface StoredLogEntry extends LogEntry {
  id: string
}

type LogSubscriber = {
  id: string
  onEvent: (entry: StoredLogEntry) => void
  close: () => void
}

const ringBuffer: StoredLogEntry[] = []
const subscribers = new Set<LogSubscriber>()
let pruneTimer: ReturnType<typeof setInterval> | null = null
let persistQueue: StoredLogEntry[] = []
let flushTimer: ReturnType<typeof setTimeout> | null = null

function bufferSize(): number {
  return Math.max(1, env.LOG_BUFFER_SIZE)
}

function pushRing(entry: StoredLogEntry): void {
  ringBuffer.push(entry)
  const max = bufferSize()
  while (ringBuffer.length > max) {
    ringBuffer.shift()
  }
}

function enqueuePersist(entry: StoredLogEntry): void {
  if (!env.LOG_PERSIST) return
  persistQueue.push(entry)
  if (flushTimer) return
  flushTimer = setTimeout(() => {
    flushTimer = null
    void flushPersist()
  }, 250)
}

async function flushPersist(): Promise<void> {
  if (persistQueue.length === 0) return
  const batch = persistQueue
  persistQueue = []
  const client = getClient()
  for (const entry of batch) {
    try {
      await client.execute({
        sql: `INSERT INTO "_base_logs" (
          "id", "ts", "level", "kind", "message", "method", "path", "status",
          "durationMs", "requestId", "userId", "ip", "userAgent", "meta"
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          entry.id,
          entry.ts,
          entry.level,
          entry.kind,
          entry.message,
          entry.method ?? null,
          entry.path ?? null,
          entry.status ?? null,
          entry.durationMs ?? null,
          entry.requestId ?? null,
          entry.userId ?? null,
          entry.ip ?? null,
          entry.userAgent ?? null,
          entry.meta ? JSON.stringify(entry.meta) : null,
        ],
      })
    } catch {
      // Never break the request path for log persistence
    }
  }
}

function onLog(entry: LogEntry): void {
  const stored: StoredLogEntry = {
    ...entry,
    id: entry.id || ulid(),
  }
  pushRing(stored)
  enqueuePersist(stored)
  for (const sub of subscribers) {
    try {
      sub.onEvent(stored)
    } catch {
      // ignore
    }
  }
}

/** Wire logger → bus. Call once at boot / createApp. */
export function initLogBus(): void {
  setLogSink(onLog)
  if (!pruneTimer && env.LOG_PERSIST) {
    pruneTimer = setInterval(
      () => {
        void pruneLogs()
      },
      60 * 60 * 1000,
    )
  }
}

export function subscribeLogs(opts: {
  onEvent: (entry: StoredLogEntry) => void
  onClose?: () => void
}): () => void {
  const id = ulid()
  const sub: LogSubscriber = {
    id,
    onEvent: opts.onEvent,
    close: () => {
      subscribers.delete(sub)
      opts.onClose?.()
    },
  }
  subscribers.add(sub)
  return () => sub.close()
}

export function getRecentLogs(limit = 100): StoredLogEntry[] {
  return ringBuffer.slice(-limit)
}

export async function queryLogs(opts: {
  level?: string
  kind?: string
  status?: number
  path?: string
  userId?: string
  from?: number
  to?: number
  page?: number
  perPage?: number
}): Promise<{ data: StoredLogEntry[]; meta: { page: number; perPage: number; total: number } }> {
  const page = Math.max(1, opts.page || 1)
  const perPage = Math.min(200, Math.max(1, opts.perPage || 50))
  const offset = (page - 1) * perPage

  const where: string[] = ['1=1']
  const args: unknown[] = []

  if (opts.level) {
    where.push('"level" = ?')
    args.push(opts.level)
  }
  if (opts.kind) {
    where.push('"kind" = ?')
    args.push(opts.kind)
  }
  if (opts.status !== undefined) {
    where.push('"status" = ?')
    args.push(opts.status)
  }
  if (opts.path) {
    where.push('"path" LIKE ?')
    args.push(`%${opts.path}%`)
  }
  if (opts.userId) {
    where.push('"userId" = ?')
    args.push(opts.userId)
  }
  if (opts.from) {
    where.push('"ts" >= ?')
    args.push(opts.from)
  }
  if (opts.to) {
    where.push('"ts" <= ?')
    args.push(opts.to)
  }

  const client = getClient()
  const whereSql = where.join(' AND ')
  const count = await client.execute({
    sql: `SELECT COUNT(*) as total FROM "_base_logs" WHERE ${whereSql}`,
    args: args as any[],
  })
  const total = Number(count.rows[0]?.total || 0)

  const result = await client.execute({
    sql: `SELECT * FROM "_base_logs" WHERE ${whereSql} ORDER BY "ts" DESC LIMIT ? OFFSET ?`,
    args: [...args, perPage, offset] as any[],
  })

  const data = (result.rows || []).map((row) => {
    const r = row as Record<string, unknown>
    return {
      id: String(r.id),
      ts: Number(r.ts),
      level: r.level as LogEntry['level'],
      kind: String(r.kind),
      message: String(r.message),
      method: r.method ? String(r.method) : undefined,
      path: r.path ? String(r.path) : undefined,
      status: r.status != null ? Number(r.status) : undefined,
      durationMs: r.durationMs != null ? Number(r.durationMs) : undefined,
      requestId: r.requestId ? String(r.requestId) : undefined,
      userId: r.userId ? String(r.userId) : undefined,
      ip: r.ip ? String(r.ip) : undefined,
      userAgent: r.userAgent ? String(r.userAgent) : undefined,
      meta: r.meta ? (JSON.parse(String(r.meta)) as Record<string, unknown>) : undefined,
    } satisfies StoredLogEntry
  })

  return { data, meta: { page, perPage, total } }
}

export async function pruneLogs(): Promise<number> {
  if (!env.LOG_PERSIST) return 0
  const cutoff = Date.now() - env.LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000
  const client = getClient()
  const result = await client.execute({
    sql: `DELETE FROM "_base_logs" WHERE "ts" < ?`,
    args: [cutoff],
  })
  return result.rowsAffected || 0
}

export function resetLogBusForTests(): void {
  ringBuffer.length = 0
  subscribers.clear()
  persistQueue = []
  if (flushTimer) {
    clearTimeout(flushTimer)
    flushTimer = null
  }
  if (pruneTimer) {
    clearInterval(pruneTimer)
    pruneTimer = null
  }
  setLogSink(null)
}

// Re-export for convenience
export { logger }
