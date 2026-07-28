import { createHmac } from 'node:crypto'
import { ulid } from 'ulid'
import { getClient } from '../db/client.js'
import env from '../env.js'
import type { ChangeEvent } from '../realtime/bus.js'
import { logger } from '../observability/logger.js'

export interface WebhookRecord {
  id: string
  url: string
  secret: string | null
  collections: string[]
  enabled: boolean
  createdAt: number
  updatedAt: number
}

function rowToRecord(row: Record<string, unknown>): WebhookRecord {
  return {
    id: String(row.id),
    url: String(row.url),
    secret: row.secret ? String(row.secret) : null,
    collections: JSON.parse(String(row.collections || '["*"]')) as string[],
    enabled: Boolean(row.enabled),
    createdAt: Number(row.createdAt),
    updatedAt: Number(row.updatedAt),
  }
}

export async function listWebhooks(): Promise<WebhookRecord[]> {
  const client = getClient()
  const result = await client.execute(
    `SELECT * FROM "_base_webhooks" ORDER BY "createdAt" DESC`,
  )
  return (result.rows || []).map((r) =>
    rowToRecord(r as Record<string, unknown>),
  )
}

export async function createWebhook(opts: {
  url: string
  secret?: string
  collections?: string[]
}): Promise<WebhookRecord> {
  const id = ulid()
  const now = Date.now()
  const collections = opts.collections ?? ['*']
  const client = getClient()
  await client.execute({
    sql: `INSERT INTO "_base_webhooks" (
      "id", "url", "secret", "collections", "enabled", "createdAt", "updatedAt"
    ) VALUES (?, ?, ?, ?, 1, ?, ?)`,
    args: [
      id,
      opts.url,
      opts.secret ?? null,
      JSON.stringify(collections),
      now,
      now,
    ],
  })
  return {
    id,
    url: opts.url,
    secret: opts.secret ?? null,
    collections,
    enabled: true,
    createdAt: now,
    updatedAt: now,
  }
}

export async function updateWebhook(
  id: string,
  patch: {
    url?: string
    secret?: string
    collections?: string[]
    enabled?: boolean
  },
): Promise<WebhookRecord | null> {
  const client = getClient()
  const existing = await client.execute({
    sql: `SELECT * FROM "_base_webhooks" WHERE "id" = ?`,
    args: [id],
  })
  if (!existing.rows?.length) return null
  const current = rowToRecord(existing.rows[0] as Record<string, unknown>)
  const next: WebhookRecord = {
    ...current,
    url: patch.url ?? current.url,
    secret: patch.secret !== undefined ? patch.secret : current.secret,
    collections: patch.collections ?? current.collections,
    enabled: patch.enabled !== undefined ? patch.enabled : current.enabled,
    updatedAt: Date.now(),
  }
  await client.execute({
    sql: `UPDATE "_base_webhooks" SET "url" = ?, "secret" = ?, "collections" = ?, "enabled" = ?, "updatedAt" = ? WHERE "id" = ?`,
    args: [
      next.url,
      next.secret,
      JSON.stringify(next.collections),
      next.enabled ? 1 : 0,
      next.updatedAt,
      id,
    ],
  })
  return next
}

export async function deleteWebhook(id: string): Promise<boolean> {
  const client = getClient()
  const result = await client.execute({
    sql: `DELETE FROM "_base_webhooks" WHERE "id" = ?`,
    args: [id],
  })
  return (result.rowsAffected || 0) > 0
}

async function deliver(
  webhook: WebhookRecord,
  event: ChangeEvent,
  attempt = 1,
): Promise<void> {
  const body = JSON.stringify({
    id: event.id,
    collection: event.collection,
    action: event.action,
    recordId: event.recordId,
    record: event.record,
    ts: event.ts,
  })

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'Base-Webhooks/0.1',
    'X-Base-Event-Id': event.id,
    'X-Base-Delivery-Attempt': String(attempt),
  }

  if (webhook.secret) {
    const sig = createHmac('sha256', webhook.secret).update(body).digest('hex')
    headers['X-Base-Signature'] = `sha256=${sig}`
  }

  try {
    const res = await fetch(webhook.url, {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok && attempt < 3) {
      const delay = attempt * 1000
      setTimeout(() => {
        void deliver(webhook, event, attempt + 1)
      }, delay)
    } else if (!res.ok) {
      logger.warn('webhook', `Delivery failed for ${webhook.id}`, {
        meta: { status: res.status, url: webhook.url, attempt },
      })
    }
  } catch (err) {
    if (attempt < 3) {
      setTimeout(() => {
        void deliver(webhook, event, attempt + 1)
      }, attempt * 1000)
    } else {
      logger.warn('webhook', `Delivery error for ${webhook.id}`, {
        meta: {
          error: err instanceof Error ? err.message : String(err),
          url: webhook.url,
        },
      })
    }
  }
}

/** Fan-out change events to configured webhooks (fire-and-forget). */
export function dispatchWebhooks(event: ChangeEvent): void {
  if (!env.WEBHOOKS_ENABLED) return
  void (async () => {
    try {
      const hooks = await listWebhooks()
      for (const hook of hooks) {
        if (!hook.enabled) continue
        if (
          !hook.collections.includes('*') &&
          !hook.collections.includes(event.collection)
        ) {
          continue
        }
        void deliver(hook, event)
      }
    } catch {
      // never break publisher
    }
  })()
}
