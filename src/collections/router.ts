import { Hono } from 'hono'
import type { CollectionSchema } from '../schema/types.js'
import { schemaToZod } from '../schema/to-zod.js'
import { requireAuth } from '../auth/middleware.js'
import { create, getById, update, remove } from './crud.js'
import { list, type ListParams, type FilterValue } from './query.js'
import { ForbiddenError } from './access.js'
import { getAccessLevel } from './access.js'
import { isMaintenanceMode, getMaintenanceReason } from '../server/maintenance.js'
import { writeAudit } from '../observability/audit.js'
import { getRequestId } from '../observability/request-log.js'

/**
 * Create a Hono sub-router for a single collection.
 */
export function createCollectionRouter(collection: CollectionSchema): Hono {
  const router = new Hono()
  const zodSchemas = schemaToZod(collection)

  router.use('*', async (c, next) => {
    if (isMaintenanceMode() && c.req.method !== 'GET') {
      return c.json(
        {
          error: {
            code: 'MAINTENANCE',
            message: getMaintenanceReason(),
          },
        },
        503,
      )
    }
    await next()
  })

  const readIsPublic = getAccessLevel(collection, 'read') === 'public'
  if (!readIsPublic) {
    router.use('*', requireAuth)
  } else {
    // Still attach optional auth for owner rules on other ops — require auth for mutations
    router.use('*', async (c, next) => {
      if (c.req.method === 'GET') {
        // optional: try auth but don't require
        const { optionalAuth } = await import('../auth/middleware.js')
        return optionalAuth(c, next)
      }
      return requireAuth(c, next)
    })
  }

  router.get('/', async (c) => {
    const user = c.get('user' as never) as any
    const filter = parseFilterParam(c.req.query('filter'), c.req.queries())
    const pageRaw = c.req.query('page')
    const perPageRaw = c.req.query('perPage')

    if (pageRaw !== undefined && (Number.isNaN(Number(pageRaw)) || Number(pageRaw) < 1)) {
      return c.json(
        { error: { code: 'VALIDATION_ERROR', message: 'Invalid page parameter' } },
        400,
      )
    }
    if (
      perPageRaw !== undefined &&
      (Number.isNaN(Number(perPageRaw)) || Number(perPageRaw) < 1)
    ) {
      return c.json(
        {
          error: { code: 'VALIDATION_ERROR', message: 'Invalid perPage parameter' },
        },
        400,
      )
    }

    const params: ListParams = {
      filter,
      sort: c.req.query('sort') || undefined,
      page: pageRaw ? Number(pageRaw) : 1,
      perPage: perPageRaw ? Number(perPageRaw) : 20,
      search: c.req.query('search') || undefined,
    }

    try {
      const result = await list(collection, params, user ?? null)
      return c.json(result)
    } catch (err) {
      return handleRouteError(c, err)
    }
  })

  router.get('/:id', async (c) => {
    const user = c.get('user' as never) as any
    const id = c.req.param('id')

    try {
      const record = await getById(collection, id, user ?? null)
      if (!record) {
        return c.json(
          { error: { code: 'NOT_FOUND', message: 'Record not found' } },
          404,
        )
      }
      return c.json({ data: record })
    } catch (err) {
      return handleRouteError(c, err)
    }
  })

  router.post('/', async (c) => {
    const user = c.get('user' as never) as any
    const body = await c.req.json()

    const validation = zodSchemas.create.safeParse(body)
    if (!validation.success) {
      return c.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid request data',
            details: validation.error.issues,
          },
        },
        400,
      )
    }

    try {
      const record = await create(
        collection,
        validation.data as Record<string, unknown>,
        user,
      )
      void writeAudit({
        actor: user?.id ? { kind: 'user', userId: user.id } : null,
        action: 'create',
        collection: collection.name,
        recordId: String(record.id),
        after: record,
        requestId: getRequestId(c),
      })
      return c.json({ data: record }, 201)
    } catch (err) {
      return handleRouteError(c, err)
    }
  })

  router.patch('/:id', async (c) => {
    const user = c.get('user' as never) as any
    const id = c.req.param('id')
    const body = await c.req.json()

    const validation = zodSchemas.update.safeParse(body)
    if (!validation.success) {
      return c.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid request data',
            details: validation.error.issues,
          },
        },
        400,
      )
    }

    try {
      const before = await getById(collection, id, user ?? null)
      const record = await update(
        collection,
        id,
        validation.data as Record<string, unknown>,
        user,
      )
      if (!record) {
        return c.json(
          { error: { code: 'NOT_FOUND', message: 'Record not found' } },
          404,
        )
      }
      void writeAudit({
        actor: user?.id ? { kind: 'user', userId: user.id } : null,
        action: 'update',
        collection: collection.name,
        recordId: id,
        before: before,
        after: record,
        requestId: getRequestId(c),
      })
      return c.json({ data: record })
    } catch (err) {
      return handleRouteError(c, err)
    }
  })

  router.delete('/:id', async (c) => {
    const user = c.get('user' as never) as any
    const id = c.req.param('id')
    const hard = c.req.query('hard') === 'true'

    try {
      const before = await getById(collection, id, user ?? null)
      const deleted = await remove(collection, id, !hard, user)
      if (!deleted) {
        return c.json(
          { error: { code: 'NOT_FOUND', message: 'Record not found' } },
          404,
        )
      }
      void writeAudit({
        actor: user?.id ? { kind: 'user', userId: user.id } : null,
        action: hard ? 'hard_delete' : 'delete',
        collection: collection.name,
        recordId: id,
        before: before,
        requestId: getRequestId(c),
      })
      return c.json({ data: { id, deleted: true, soft: !hard } })
    } catch (err) {
      return handleRouteError(c, err)
    }
  })

  return router
}

/**
 * Parse filter query parameter.
 * Supports:
 *   ?filter={"field":"value"}  (JSON — preferred / documented)
 *   ?filter={"field":{"op":"gte","value":10}}
 *   ?filter[field]=value       (bracket style)
 *   ?filter[field__gte]=10     (operator suffix)
 */
export function parseFilterParam(
  filter?: string,
  allQueries?: Record<string, string[]>,
): Record<string, FilterValue> | undefined {
  const fromBrackets: Record<string, FilterValue> = {}

  if (allQueries) {
    for (const [key, values] of Object.entries(allQueries)) {
      const match = key.match(/^filter\[(.+)\]$/)
      if (match && values[0] !== undefined) {
        fromBrackets[match[1]] = values[0]
      }
    }
  }

  if (Object.keys(fromBrackets).length > 0) {
    return fromBrackets
  }

  if (!filter) return undefined

  try {
    const parsed = JSON.parse(filter)
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      const out: Record<string, FilterValue> = {}
      for (const [k, v] of Object.entries(parsed)) {
        out[k] = v as FilterValue
      }
      return out
    }
  } catch {
    // Not JSON
  }

  return undefined
}

function handleRouteError(c: any, err: unknown) {
  if (err instanceof ForbiddenError) {
    return c.json({ error: { code: err.code, message: err.message } }, 403)
  }
  const e = err as Error & { status?: number; code?: string }
  if (e.status && e.code) {
    return c.json({ error: { code: e.code, message: e.message } }, e.status)
  }
  throw err
}
