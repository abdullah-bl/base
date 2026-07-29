import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { existsSync, statSync } from 'node:fs'
import { requireAdmin, getAdminActor } from './guard.js'
import {
  deleteTableRow,
  executeSql,
  getTableRow,
  listTableRows,
  updateTableRow,
} from './data.js'
import { getAllowedTables } from './tables.js'
import { getClient } from '../db/client.js'
import { getDbPath } from '../config.js'
import env from '../env.js'
import {
  applyEvolution,
  fingerprintCollection,
  formatPlan,
} from '../schema/evolve.js'
import { getRegisteredCollections } from '../schema/registry.js'
import { setUserRole } from '../auth/auth.js'
import {
  createApiKey,
  deleteApiKey,
  listApiKeys,
  revokeApiKey,
} from '../auth/api-keys.js'
import {
  createBackup,
  deleteBackup,
  getBackup,
  getBackupFilePath,
  listBackups,
  restoreBackup,
} from '../backup/index.js'
import { queryAudit, writeAudit } from '../observability/audit.js'
import {
  initLogBus,
  queryLogs,
  subscribeLogs,
} from '../observability/bus.js'
import { getRequestId } from '../observability/request-log.js'
import {
  getRecentEvents,
  getSubscriberCount,
} from '../realtime/bus.js'
import {
  deleteFileRecord,
  getFileRecord,
  listAllFileRecords,
} from '../files/meta.js'
import { deleteFile, getStorageDriver } from '../files/storage.js'
import {
  createWebhook,
  deleteWebhook,
  listWebhooks,
  updateWebhook,
} from '../webhooks/index.js'
import { mountControlPlane } from './control-plane.js'
import { getEffectiveRuntime } from '../settings/resolve.js'

const VERSION = '0.1.0'

export function createAdminRouter(): Hono {
  initLogBus()
  const router = new Hono()
  router.use('*', requireAdmin)
  mountControlPlane(router)

  // ── Overview ──────────────────────────────────────────────
  router.get('/overview', async (c) => {
    const client = getClient()
    const collections = getRegisteredCollections().filter(
      (x) => x.name !== 'user' && x.name !== 'users',
    )
    const counts: Record<string, number> = {}
    for (const col of collections) {
      try {
        const r = await client.execute(
          `SELECT COUNT(*) as total FROM "${col.name}" WHERE "deletedAt" IS NULL`,
        )
        counts[col.name] = Number(r.rows[0]?.total || 0)
      } catch {
        counts[col.name] = 0
      }
    }

    let users = 0
    let admins = 0
    try {
      const u = await client.execute(`SELECT COUNT(*) as total FROM "user"`)
      users = Number(u.rows[0]?.total || 0)
      const a = await client.execute(
        `SELECT COUNT(*) as total FROM "user" WHERE "role" = 'admin'`,
      )
      admins = Number(a.rows[0]?.total || 0)
    } catch {
      // ignore
    }

    let recentErrors = 0
    try {
      const e = await client.execute({
        sql: `SELECT COUNT(*) as total FROM "_base_logs" WHERE "level" = 'error' AND "ts" > ?`,
        args: [Date.now() - 24 * 60 * 60 * 1000],
      })
      recentErrors = Number(e.rows[0]?.total || 0)
    } catch {
      // ignore
    }

    const dbPath = getDbPath()
    let dbSize: number | null = null
    if (dbPath && existsSync(dbPath)) {
      dbSize = statSync(dbPath).size
    }

    return c.json({
      data: {
        version: VERSION,
        uptime: process.uptime(),
        nodeEnv: env.NODE_ENV,
        storageDriver: env.STORAGE_DRIVER,
        databaseUrl: env.DATABASE_URL.startsWith('file:')
          ? env.DATABASE_URL
          : '[remote]',
        dbSize,
        collections: counts,
        users,
        admins,
        realtimeSubscribers: getSubscriberCount(),
        recentErrors24h: recentErrors,
        adminPath: env.ADMIN_PATH,
      },
    })
  })

  // ── Collections / schema ──────────────────────────────────
  router.get('/collections', async (c) => {
    const client = getClient()
    const collections = getRegisteredCollections().filter(
      (x) => x.name !== 'user' && x.name !== 'users',
    )
    const fingerprints = await client.execute(
      `SELECT "collection", "fingerprint", "updatedAt" FROM "_base_schema"`,
    )
    const fpMap = new Map(
      (fingerprints.rows || []).map((r) => {
        const row = r as unknown as {
          collection: string
          fingerprint: string
          updatedAt: number
        }
        return [row.collection, row]
      }),
    )

    const data = await Promise.all(
      collections.map(async (col) => {
        let count = 0
        try {
          const r = await client.execute(
            `SELECT COUNT(*) as total FROM "${col.name}" WHERE "deletedAt" IS NULL`,
          )
          count = Number(r.rows[0]?.total || 0)
        } catch {
          count = 0
        }
        const stored = fpMap.get(col.name)
        return {
          name: col.name,
          fields: col.fields,
          indexes: col.indexes,
          access: col.access,
          fingerprint: fingerprintCollection(col),
          storedFingerprint: stored?.fingerprint ?? null,
          rowCount: count,
        }
      }),
    )
    return c.json({ data })
  })

  router.get('/schema/status', async (c) => {
    const collections = getRegisteredCollections().filter(
      (x) => x.name !== 'user' && x.name !== 'users',
    )
    const plan = await applyEvolution(collections, { dryRun: true })
    return c.json({
      data: {
        plan,
        formatted: formatPlan(plan),
      },
    })
  })

  router.post('/schema/apply', async (c) => {
    const collections = getRegisteredCollections().filter(
      (x) => x.name !== 'user' && x.name !== 'users',
    )
    const plan = await applyEvolution(collections, { dryRun: false })
    await writeAudit({
      actor: getAdminActor(c),
      action: 'schema.apply',
      after: { ops: plan.ops.length, blocked: plan.blocked.length },
      requestId: getRequestId(c),
    })
    return c.json({
      data: { plan, formatted: formatPlan(plan) },
    })
  })

  router.get('/migrations', async (c) => {
    const page = Math.max(1, Number(c.req.query('page') || 1))
    const perPage = Math.min(200, Math.max(1, Number(c.req.query('perPage') || 50)))
    const offset = (page - 1) * perPage
    const client = getClient()
    const count = await client.execute(
      `SELECT COUNT(*) as total FROM "_base_migrations"`,
    )
    const total = Number(count.rows[0]?.total || 0)
    const result = await client.execute({
      sql: `SELECT * FROM "_base_migrations" ORDER BY "appliedAt" DESC LIMIT ? OFFSET ?`,
      args: [perPage, offset],
    })
    return c.json({
      data: result.rows || [],
      meta: { page, perPage, total },
    })
  })

  // ── Data viewer ───────────────────────────────────────────
  router.get('/data', (c) => {
    return c.json({ data: getAllowedTables() })
  })

  router.get('/data/:table', async (c) => {
    try {
      const result = await listTableRows(c.req.param('table'), {
        page: Number(c.req.query('page') || 1),
        perPage: Number(c.req.query('perPage') || 50),
        sort: c.req.query('sort') || undefined,
        search: c.req.query('search') || undefined,
        searchColumn: c.req.query('searchColumn') || undefined,
      })
      return c.json(result)
    } catch (err) {
      return handleAdminError(c, err)
    }
  })

  router.get('/data/:table/:id', async (c) => {
    try {
      const row = await getTableRow(c.req.param('table'), c.req.param('id'))
      if (!row) {
        return c.json(
          { error: { code: 'NOT_FOUND', message: 'Row not found' } },
          404,
        )
      }
      return c.json({ data: row })
    } catch (err) {
      return handleAdminError(c, err)
    }
  })

  router.patch('/data/:table/:id', async (c) => {
    try {
      const table = c.req.param('table')
      const id = c.req.param('id')
      const body = (await c.req.json()) as Record<string, unknown>
      const before = await getTableRow(table, id)
      const after = await updateTableRow(table, id, body)
      await writeAudit({
        actor: getAdminActor(c),
        action: 'admin.update',
        collection: table,
        recordId: id,
        before,
        after: after ?? null,
        requestId: getRequestId(c),
      })
      return c.json({ data: after })
    } catch (err) {
      return handleAdminError(c, err)
    }
  })

  router.delete('/data/:table/:id', async (c) => {
    try {
      const table = c.req.param('table')
      const id = c.req.param('id')
      const before = await getTableRow(table, id)
      const ok = await deleteTableRow(table, id)
      if (!ok) {
        return c.json(
          { error: { code: 'NOT_FOUND', message: 'Row not found' } },
          404,
        )
      }
      await writeAudit({
        actor: getAdminActor(c),
        action: 'admin.delete',
        collection: table,
        recordId: id,
        before,
        requestId: getRequestId(c),
      })
      return c.json({ data: { id, deleted: true } })
    } catch (err) {
      return handleAdminError(c, err)
    }
  })

  // ── SQL console ───────────────────────────────────────────
  router.post('/sql', async (c) => {
    try {
      const body = (await c.req.json()) as {
        sql?: string
        confirm?: boolean
      }
      if (!body.sql) {
        return c.json(
          { error: { code: 'VALIDATION_ERROR', message: 'sql is required' } },
          400,
        )
      }
      const result = await executeSql(body.sql, {
        confirmWrite: Boolean(body.confirm),
      })
      if (!result.readonly) {
        await writeAudit({
          actor: getAdminActor(c),
          action: 'admin.sql',
          after: { sql: body.sql, rowsAffected: result.rowsAffected },
          requestId: getRequestId(c),
        })
      }
      return c.json({ data: result })
    } catch (err) {
      return handleAdminError(c, err)
    }
  })

  // ── Logs ──────────────────────────────────────────────────
  router.get('/logs', async (c) => {
    const result = await queryLogs({
      level: c.req.query('level') || undefined,
      kind: c.req.query('kind') || undefined,
      status: c.req.query('status')
        ? Number(c.req.query('status'))
        : undefined,
      path: c.req.query('path') || undefined,
      userId: c.req.query('userId') || undefined,
      from: c.req.query('from') ? Number(c.req.query('from')) : undefined,
      to: c.req.query('to') ? Number(c.req.query('to')) : undefined,
      page: Number(c.req.query('page') || 1),
      perPage: Number(c.req.query('perPage') || 50),
    })
    return c.json(result)
  })

  router.get('/logs/stream', async (c) => {
    return streamSSE(c, async (stream) => {
      let closed = false
      const unsub = subscribeLogs({
        onEvent: (entry) => {
          if (closed) return
          void stream
            .writeSSE({
              event: 'log',
              id: entry.id,
              data: JSON.stringify(entry),
            })
            .catch(() => {
              closed = true
            })
        },
      })

      await stream.writeSSE({
        event: 'open',
        data: JSON.stringify({ ok: true }),
      })

      const heartbeat = setInterval(() => {
        if (closed) return
        void stream.writeSSE({ event: 'heartbeat', data: '' }).catch(() => {
          closed = true
        })
      }, 15_000)

      stream.onAbort(() => {
        closed = true
        clearInterval(heartbeat)
        unsub()
      })

      while (!closed) {
        await stream.sleep(1000)
      }
      clearInterval(heartbeat)
      unsub()
    })
  })

  // ── Audit ─────────────────────────────────────────────────
  router.get('/audit', async (c) => {
    const result = await queryAudit({
      action: c.req.query('action') || undefined,
      collection: c.req.query('collection') || undefined,
      actorId: c.req.query('actorId') || undefined,
      from: c.req.query('from') ? Number(c.req.query('from')) : undefined,
      to: c.req.query('to') ? Number(c.req.query('to')) : undefined,
      page: Number(c.req.query('page') || 1),
      perPage: Number(c.req.query('perPage') || 50),
    })
    return c.json(result)
  })

  // ── Users ─────────────────────────────────────────────────
  router.get('/users', async (c) => {
    const page = Math.max(1, Number(c.req.query('page') || 1))
    const perPage = Math.min(200, Math.max(1, Number(c.req.query('perPage') || 50)))
    const offset = (page - 1) * perPage
    const q = c.req.query('search')
    const client = getClient()
    const where = q ? `"email" LIKE ? OR "name" LIKE ?` : '1=1'
    const args: unknown[] = q ? [`%${q}%`, `%${q}%`] : []
    const count = await client.execute({
      sql: `SELECT COUNT(*) as total FROM "user" WHERE ${where}`,
      args: args as any[],
    })
    const total = Number(count.rows[0]?.total || 0)
    const result = await client.execute({
      sql: `SELECT "id", "name", "email", "emailVerified", "image", "role", "createdAt", "updatedAt"
            FROM "user" WHERE ${where} ORDER BY "createdAt" DESC LIMIT ? OFFSET ?`,
      args: [...args, perPage, offset] as any[],
    })
    return c.json({
      data: result.rows || [],
      meta: { page, perPage, total },
    })
  })

  router.patch('/users/:id/role', async (c) => {
    const id = c.req.param('id')
    const body = (await c.req.json()) as { role?: string }
    if (body.role !== 'admin' && body.role !== 'user') {
      return c.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'role must be admin or user',
          },
        },
        400,
      )
    }
    try {
      const ok = await setUserRole(id, body.role)
      if (!ok) {
        return c.json(
          { error: { code: 'NOT_FOUND', message: 'User not found' } },
          404,
        )
      }
    } catch (err) {
      const e = err as Error & { status?: number; code?: string }
      return c.json(
        { error: { code: e.code || 'VALIDATION_ERROR', message: e.message } },
        (e.status as 400) || 400,
      )
    }
    await writeAudit({
      actor: getAdminActor(c),
      action: 'user.role',
      collection: 'user',
      recordId: id,
      after: { role: body.role },
      requestId: getRequestId(c),
    })
    return c.json({ data: { id, role: body.role } })
  })

  router.delete('/users/:id/sessions', async (c) => {
    const id = c.req.param('id')
    const client = getClient()
    const result = await client.execute({
      sql: `DELETE FROM "session" WHERE "userId" = ?`,
      args: [id],
    })
    await writeAudit({
      actor: getAdminActor(c),
      action: 'user.revoke_sessions',
      collection: 'user',
      recordId: id,
      after: { revoked: result.rowsAffected || 0 },
      requestId: getRequestId(c),
    })
    return c.json({ data: { id, revoked: result.rowsAffected || 0 } })
  })

  router.delete('/users/:id', async (c) => {
    const id = c.req.param('id')
    const client = getClient()
    const before = await client.execute({
      sql: `SELECT "id", "email", "role" FROM "user" WHERE "id" = ?`,
      args: [id],
    })
    if (!before.rows?.length) {
      return c.json(
        { error: { code: 'NOT_FOUND', message: 'User not found' } },
        404,
      )
    }
    const role = String((before.rows[0] as { role?: string }).role || '')
    if (role === 'admin') {
      const admins = await client.execute(
        `SELECT COUNT(*) as total FROM "user" WHERE "role" = 'admin'`,
      )
      if (Number(admins.rows[0]?.total || 0) <= 1) {
        return c.json(
          {
            error: {
              code: 'LAST_ADMIN',
              message: 'Cannot delete the last admin',
            },
          },
          400,
        )
      }
    }
    await client.execute({
      sql: `DELETE FROM "session" WHERE "userId" = ?`,
      args: [id],
    })
    await client.execute({
      sql: `DELETE FROM "account" WHERE "userId" = ?`,
      args: [id],
    })
    await client.execute({
      sql: `DELETE FROM "user" WHERE "id" = ?`,
      args: [id],
    })
    await writeAudit({
      actor: getAdminActor(c),
      action: 'user.delete',
      collection: 'user',
      recordId: id,
      before: before.rows[0] as Record<string, unknown>,
      requestId: getRequestId(c),
    })
    return c.json({ data: { id, deleted: true } })
  })

  // ── Files ─────────────────────────────────────────────────
  router.get('/files', async (c) => {
    const page = Math.max(1, Number(c.req.query('page') || 1))
    const perPage = Math.min(200, Math.max(1, Number(c.req.query('perPage') || 50)))
    const result = await listAllFileRecords(page, perPage)
    return c.json(result)
  })

  router.get('/files/stats', async (c) => {
    const client = getClient()
    try {
      const r = await client.execute(
        `SELECT COUNT(*) as count, COALESCE(SUM("size"), 0) as bytes FROM "files"`,
      )
      return c.json({
        data: {
          count: Number(r.rows[0]?.count || 0),
          bytes: Number(r.rows[0]?.bytes || 0),
          driver: env.STORAGE_DRIVER,
        },
      })
    } catch {
      return c.json({
        data: { count: 0, bytes: 0, driver: env.STORAGE_DRIVER },
      })
    }
  })

  router.delete('/files/:id', async (c) => {
    const id = c.req.param('id')
    const record = await getFileRecord(id)
    if (!record) {
      return c.json(
        { error: { code: 'NOT_FOUND', message: 'File not found' } },
        404,
      )
    }
    await deleteFileRecord(id)
    await deleteFile(record.storageKey)
    await writeAudit({
      actor: getAdminActor(c),
      action: 'file.delete',
      collection: 'files',
      recordId: id,
      before: record as unknown as Record<string, unknown>,
      requestId: getRequestId(c),
    })
    return c.json({ data: { id, deleted: true } })
  })

  // ── Realtime ──────────────────────────────────────────────
  router.get('/realtime', async (c) => {
    const runtime = await getEffectiveRuntime()
    return c.json({
      data: {
        enabled: runtime.realtimeEnabled,
        subscribers: getSubscriberCount(),
        recentEvents: getRecentEvents(50),
      },
    })
  })

  // Settings moved to control-plane (GET/PATCH /settings)

  // ── Metrics ───────────────────────────────────────────────
  router.get('/metrics', async (c) => {
    const client = getClient()
    const collections = getRegisteredCollections().filter(
      (x) => x.name !== 'user' && x.name !== 'users',
    )
    const lines: string[] = [
      '# HELP base_uptime_seconds Process uptime in seconds',
      '# TYPE base_uptime_seconds gauge',
      `base_uptime_seconds ${process.uptime()}`,
      '# HELP base_realtime_subscribers Connected SSE subscribers',
      '# TYPE base_realtime_subscribers gauge',
      `base_realtime_subscribers ${getSubscriberCount()}`,
    ]

    for (const col of collections) {
      try {
        const r = await client.execute(
          `SELECT COUNT(*) as total FROM "${col.name}" WHERE "deletedAt" IS NULL`,
        )
        lines.push(
          `base_collection_rows{collection="${col.name}"} ${Number(r.rows[0]?.total || 0)}`,
        )
      } catch {
        lines.push(`base_collection_rows{collection="${col.name}"} 0`)
      }
    }

    return c.text(lines.join('\n') + '\n', 200, {
      'Content-Type': 'text/plain; version=0.0.4',
    })
  })

  // ── Backups ───────────────────────────────────────────────
  router.get('/backups', (c) => {
    return c.json({ data: listBackups() })
  })

  router.post('/backups', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      includeUploads?: boolean
    }
    const manifest = await createBackup({
      includeUploads: body.includeUploads !== false,
    })
    await writeAudit({
      actor: getAdminActor(c),
      action: 'backup.create',
      recordId: manifest.id,
      after: manifest as unknown as Record<string, unknown>,
      requestId: getRequestId(c),
    })
    return c.json({ data: manifest }, 201)
  })

  router.get('/backups/:id/download', async (c) => {
    const manifest = getBackup(c.req.param('id'))
    if (!manifest) {
      return c.json(
        { error: { code: 'NOT_FOUND', message: 'Backup not found' } },
        404,
      )
    }
    const path = getBackupFilePath(manifest)
    if (!existsSync(path)) {
      return c.json(
        { error: { code: 'NOT_FOUND', message: 'Backup file missing' } },
        404,
      )
    }
    const file = Bun.file(path)
    return new Response(file, {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${manifest.dbFile}"`,
      },
    })
  })

  router.post('/backups/:id/restore', async (c) => {
    try {
      const actor = getAdminActor(c)
      await restoreBackup(c.req.param('id'), {
        actorId: actor.kind === 'user' ? actor.userId : undefined,
        requestId: getRequestId(c),
      })
      return c.json({ data: { restored: true, id: c.req.param('id') } })
    } catch (err) {
      return handleAdminError(c, err)
    }
  })

  router.delete('/backups/:id', async (c) => {
    const ok = await deleteBackup(c.req.param('id'))
    if (!ok) {
      return c.json(
        { error: { code: 'NOT_FOUND', message: 'Backup not found' } },
        404,
      )
    }
    await writeAudit({
      actor: getAdminActor(c),
      action: 'backup.delete',
      recordId: c.req.param('id'),
      requestId: getRequestId(c),
    })
    return c.json({ data: { deleted: true } })
  })

  // ── API keys ──────────────────────────────────────────────
  router.get('/api-keys', async (c) => {
    return c.json({ data: await listApiKeys() })
  })

  router.post('/api-keys', async (c) => {
    const body = (await c.req.json()) as {
      name?: string
      scopes?: string[]
      expiresAt?: number | null
    }
    if (!body.name) {
      return c.json(
        { error: { code: 'VALIDATION_ERROR', message: 'name is required' } },
        400,
      )
    }
    const actor = getAdminActor(c)
    const created = await createApiKey({
      name: body.name,
      scopes: body.scopes,
      expiresAt: body.expiresAt,
      createdBy: actor.kind === 'user' ? actor.userId : 'admin-token',
    })
    await writeAudit({
      actor,
      action: 'api_key.create',
      recordId: created.record.id,
      after: { name: created.record.name, keyPrefix: created.record.keyPrefix },
      requestId: getRequestId(c),
    })
    return c.json({ data: { ...created.record, key: created.key } }, 201)
  })

  router.post('/api-keys/:id/revoke', async (c) => {
    const ok = await revokeApiKey(c.req.param('id'))
    if (!ok) {
      return c.json(
        { error: { code: 'NOT_FOUND', message: 'API key not found' } },
        404,
      )
    }
    await writeAudit({
      actor: getAdminActor(c),
      action: 'api_key.revoke',
      recordId: c.req.param('id'),
      requestId: getRequestId(c),
    })
    return c.json({ data: { revoked: true } })
  })

  router.delete('/api-keys/:id', async (c) => {
    const ok = await deleteApiKey(c.req.param('id'))
    if (!ok) {
      return c.json(
        { error: { code: 'NOT_FOUND', message: 'API key not found' } },
        404,
      )
    }
    await writeAudit({
      actor: getAdminActor(c),
      action: 'api_key.delete',
      recordId: c.req.param('id'),
      requestId: getRequestId(c),
    })
    return c.json({ data: { deleted: true } })
  })

  // ── Webhooks ──────────────────────────────────────────────
  router.get('/webhooks', async (c) => {
    return c.json({ data: await listWebhooks() })
  })

  router.post('/webhooks', async (c) => {
    const body = (await c.req.json()) as {
      url?: string
      secret?: string
      collections?: string[]
    }
    if (!body.url) {
      return c.json(
        { error: { code: 'VALIDATION_ERROR', message: 'url is required' } },
        400,
      )
    }
    const wh = await createWebhook({
      url: body.url,
      secret: body.secret,
      collections: body.collections,
    })
    await writeAudit({
      actor: getAdminActor(c),
      action: 'webhook.create',
      recordId: wh.id,
      after: wh as unknown as Record<string, unknown>,
      requestId: getRequestId(c),
    })
    return c.json({ data: wh }, 201)
  })

  router.patch('/webhooks/:id', async (c) => {
    const body = (await c.req.json()) as {
      url?: string
      secret?: string
      collections?: string[]
      enabled?: boolean
    }
    const wh = await updateWebhook(c.req.param('id'), body)
    if (!wh) {
      return c.json(
        { error: { code: 'NOT_FOUND', message: 'Webhook not found' } },
        404,
      )
    }
    return c.json({ data: wh })
  })

  router.delete('/webhooks/:id', async (c) => {
    const ok = await deleteWebhook(c.req.param('id'))
    if (!ok) {
      return c.json(
        { error: { code: 'NOT_FOUND', message: 'Webhook not found' } },
        404,
      )
    }
    await writeAudit({
      actor: getAdminActor(c),
      action: 'webhook.delete',
      recordId: c.req.param('id'),
      requestId: getRequestId(c),
    })
    return c.json({ data: { deleted: true } })
  })

  // Silence unused import when tree-shaken oddly
  void getStorageDriver

  return router
}

function handleAdminError(c: any, err: unknown) {
  const e = err as Error & { status?: number; code?: string }
  if (e.status && e.code) {
    return c.json({ error: { code: e.code, message: e.message } }, e.status)
  }
  throw err
}
