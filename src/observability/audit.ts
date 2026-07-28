import { ulid } from 'ulid'
import { getClient } from '../db/client.js'
import type { AdminActor } from '../admin/guard.js'

export interface AuditEntry {
  id: string
  ts: number
  actorId: string | null
  actorKind: string
  action: string
  collection: string | null
  recordId: string | null
  before: Record<string, unknown> | null
  after: Record<string, unknown> | null
  ip: string | null
  requestId: string | null
}

export async function writeAudit(opts: {
  actor?: AdminActor | { kind: 'user'; userId: string } | { kind: 'system' } | null
  action: string
  collection?: string | null
  recordId?: string | null
  before?: Record<string, unknown> | null
  after?: Record<string, unknown> | null
  ip?: string | null
  requestId?: string | null
}): Promise<void> {
  const actor = opts.actor
  let actorId: string | null = null
  let actorKind = 'system'
  if (actor) {
    if (actor.kind === 'token') {
      actorKind = 'token'
      actorId = 'admin-token'
    } else if (actor.kind === 'user') {
      actorKind = 'user'
      actorId = actor.userId
    } else {
      actorKind = 'system'
    }
  }

  const entry: AuditEntry = {
    id: ulid(),
    ts: Date.now(),
    actorId,
    actorKind,
    action: opts.action,
    collection: opts.collection ?? null,
    recordId: opts.recordId ?? null,
    before: opts.before ?? null,
    after: opts.after ?? null,
    ip: opts.ip ?? null,
    requestId: opts.requestId ?? null,
  }

  try {
    const client = getClient()
    await client.execute({
      sql: `INSERT INTO "_base_audit" (
        "id", "ts", "actorId", "actorKind", "action", "collection", "recordId",
        "before", "after", "ip", "requestId"
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        entry.id,
        entry.ts,
        entry.actorId,
        entry.actorKind,
        entry.action,
        entry.collection,
        entry.recordId,
        entry.before ? JSON.stringify(entry.before) : null,
        entry.after ? JSON.stringify(entry.after) : null,
        entry.ip,
        entry.requestId,
      ],
    })
  } catch {
    // Never break primary path
  }
}

export async function queryAudit(opts: {
  action?: string
  collection?: string
  actorId?: string
  from?: number
  to?: number
  page?: number
  perPage?: number
}): Promise<{ data: AuditEntry[]; meta: { page: number; perPage: number; total: number } }> {
  const page = Math.max(1, opts.page || 1)
  const perPage = Math.min(200, Math.max(1, opts.perPage || 50))
  const offset = (page - 1) * perPage

  const where: string[] = ['1=1']
  const args: unknown[] = []

  if (opts.action) {
    where.push('"action" = ?')
    args.push(opts.action)
  }
  if (opts.collection) {
    where.push('"collection" = ?')
    args.push(opts.collection)
  }
  if (opts.actorId) {
    where.push('"actorId" = ?')
    args.push(opts.actorId)
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
    sql: `SELECT COUNT(*) as total FROM "_base_audit" WHERE ${whereSql}`,
    args: args as any[],
  })
  const total = Number(count.rows[0]?.total || 0)

  const result = await client.execute({
    sql: `SELECT * FROM "_base_audit" WHERE ${whereSql} ORDER BY "ts" DESC LIMIT ? OFFSET ?`,
    args: [...args, perPage, offset] as any[],
  })

  const data = (result.rows || []).map((row) => {
    const r = row as Record<string, unknown>
    return {
      id: String(r.id),
      ts: Number(r.ts),
      actorId: r.actorId ? String(r.actorId) : null,
      actorKind: String(r.actorKind),
      action: String(r.action),
      collection: r.collection ? String(r.collection) : null,
      recordId: r.recordId ? String(r.recordId) : null,
      before: r.before
        ? (JSON.parse(String(r.before)) as Record<string, unknown>)
        : null,
      after: r.after
        ? (JSON.parse(String(r.after)) as Record<string, unknown>)
        : null,
      ip: r.ip ? String(r.ip) : null,
      requestId: r.requestId ? String(r.requestId) : null,
    } satisfies AuditEntry
  })

  return { data, meta: { page, perPage, total } }
}
