import { Hono } from 'hono'
import type { Context, Next } from 'hono'
import { getCollection, getRegisteredCollections } from '../schema/registry.js'
import { schemaToZod } from '../schema/to-zod.js'
import { requireAuth, optionalAuth } from '../auth/middleware.js'
import { create, getById, update, remove } from './crud.js'
import { list, type ListParams } from './query.js'
import { ForbiddenError, getAccessLevel } from './access.js'
import { isMaintenanceMode, getMaintenanceReason } from '../server/maintenance.js'
import { writeAudit } from '../observability/audit.js'
import { getRequestId } from '../observability/request-log.js'
import { fingerprintCollection } from '../schema/evolve.js'
import type { CollectionSchema } from '../schema/types.js'
import { parseFilterParam } from './router.js'
import { expandRecords } from './expand.js'

const zodCache = new Map<string, ReturnType<typeof schemaToZod>>()

function getZod(collection: CollectionSchema) {
  const fp = fingerprintCollection(collection)
  const key = `${collection.name}:${fp}`
  let z = zodCache.get(key)
  if (!z) {
    z = schemaToZod(collection)
    zodCache.set(key, z)
  }
  return z
}

export function resetDynamicRouterCache(): void {
  zodCache.clear()
}

function resolveCollection(c: Context): CollectionSchema | null {
  const name = c.req.param('name')
  if (!name || name === 'user' || name === 'users') return null
  return getCollection(name) ?? null
}

async function collectionAuth(c: Context, next: Next) {
  const collection = resolveCollection(c)
  if (!collection) {
    return c.json(
      { error: { code: 'NOT_FOUND', message: 'Collection not found' } },
      404,
    )
  }
  c.set('collection' as never, collection as never)

  const readIsPublic = getAccessLevel(collection, 'read') === 'public'
  if (!readIsPublic) {
    return requireAuth(c, next)
  }
  if (c.req.method === 'GET') {
    return optionalAuth(c, next)
  }
  return requireAuth(c, next)
}

function handleRouteError(c: Context, err: unknown) {
  if (err instanceof ForbiddenError) {
    return c.json({ error: { code: err.code, message: err.message } }, 403)
  }
  const e = err as Error & { status?: number; code?: string }
  if (e.status && e.code) {
    return c.json(
      { error: { code: e.code, message: e.message } },
      e.status as 400,
    )
  }
  throw err
}

/**
 * Dynamic /api/collections/:name router — schema resolved per request.
 */
export function createDynamicCollectionsRouter(): Hono {
  const router = new Hono()

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

  router.use('/:name', collectionAuth)
  router.use('/:name/:id', collectionAuth)

  router.get('/:name', async (c) => {
    const collection = c.get('collection' as never) as CollectionSchema
    const user = c.get('user' as never) as any
    const filter = parseFilterParam(c.req.query('filter'), c.req.queries())
    const pageRaw = c.req.query('page')
    const perPageRaw = c.req.query('perPage')

    if (
      pageRaw !== undefined &&
      (Number.isNaN(Number(pageRaw)) || Number(pageRaw) < 1)
    ) {
      return c.json(
        {
          error: { code: 'VALIDATION_ERROR', message: 'Invalid page parameter' },
        },
        400,
      )
    }
    if (
      perPageRaw !== undefined &&
      (Number.isNaN(Number(perPageRaw)) || Number(perPageRaw) < 1)
    ) {
      return c.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid perPage parameter',
          },
        },
        400,
      )
    }

    const params: ListParams = {
      filter,
      sort: c.req.query('sort') || undefined,
      page: pageRaw ? Number(pageRaw) : 1,
      perPage: perPageRaw ? Number(perPageRaw) : 20,
      search: c.req.query('search') || c.req.query('q') || undefined,
    }

    try {
      const result = await list(collection, params, user ?? null)
      const expand = c.req.query('expand')
      if (expand && result.data?.length) {
        result.data = await expandRecords(
          collection,
          result.data as Record<string, unknown>[],
          expand,
          user ?? null,
        )
      }
      return c.json(result)
    } catch (err) {
      return handleRouteError(c, err)
    }
  })

  router.get('/:name/:id', async (c) => {
    const collection = c.get('collection' as never) as CollectionSchema
    const user = c.get('user' as never) as any
    const id = c.req.param('id')

    try {
      let record = await getById(collection, id, user ?? null)
      if (!record) {
        return c.json(
          { error: { code: 'NOT_FOUND', message: 'Record not found' } },
          404,
        )
      }
      const expand = c.req.query('expand')
      if (expand) {
        const [expanded] = await expandRecords(
          collection,
          [record],
          expand,
          user ?? null,
        )
        record = expanded
      }
      return c.json({ data: record })
    } catch (err) {
      return handleRouteError(c, err)
    }
  })

  router.post('/:name', async (c) => {
    const collection = c.get('collection' as never) as CollectionSchema
    const user = c.get('user' as never) as any
    const body = await c.req.json()
    const zodSchemas = getZod(collection)

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

  router.patch('/:name/:id', async (c) => {
    const collection = c.get('collection' as never) as CollectionSchema
    const user = c.get('user' as never) as any
    const id = c.req.param('id')
    const body = await c.req.json()
    const zodSchemas = getZod(collection)

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
        before,
        after: record,
        requestId: getRequestId(c),
      })
      return c.json({ data: record })
    } catch (err) {
      return handleRouteError(c, err)
    }
  })

  router.delete('/:name/:id', async (c) => {
    const collection = c.get('collection' as never) as CollectionSchema
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
        before,
        requestId: getRequestId(c),
      })
      return c.json({ data: { id, deleted: true, soft: !hard } })
    } catch (err) {
      return handleRouteError(c, err)
    }
  })

  return router
}

export function listMountedCollectionNames(): string[] {
  return getRegisteredCollections()
    .filter((c) => c.name !== 'user' && c.name !== 'users')
    .map((c) => c.name)
}
