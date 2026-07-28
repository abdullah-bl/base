import { Hono } from 'hono'
import type { CollectionSchema } from '../schema/types.js'
import { schemaToZod } from '../schema/to-zod.js'
import { requireAuth } from '../auth/middleware.js'
import { create, getById, update, remove } from './crud.js'
import { list, type ListParams } from './query.js'

/**
 * Create a Hono sub-router for a single collection.
 * Generates GET (list), GET/:id, POST, PATCH/:id, DELETE/:id routes.
 */
export function createCollectionRouter(collection: CollectionSchema): Hono {
  const router = new Hono()
  const zodSchemas = schemaToZod(collection)

  // All collection routes require authentication
  router.use('*', requireAuth)

  // GET / — list with filtering, sorting, pagination
  router.get('/', async (c) => {
    const params: ListParams = {
      filter: parseFilterParam(c.req.query('filter')),
      sort: c.req.query('sort') || undefined,
      page: c.req.query('page') ? Number(c.req.query('page')) : 1,
      perPage: c.req.query('perPage') ? Number(c.req.query('perPage')) : 20,
    }

    const result = await list(collection, params)
    return c.json(result)
  })

  // GET /:id — get by ID
  router.get('/:id', async (c) => {
    const id = c.req.param('id')
    const record = await getById(collection, id)

    if (!record) {
      return c.json({ error: { code: 'NOT_FOUND', message: 'Record not found' } }, 404)
    }

    return c.json({ data: record })
  })

  // POST / — create new record
  router.post('/', async (c) => {
    const body = await c.req.json()

    // Validate with Zod
    const validation = zodSchemas.create.safeParse(body)
    if (!validation.success) {
      return c.json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid request data',
          details: validation.error.issues,
        },
      }, 400)
    }

    const record = await create(collection, validation.data as Record<string, any>)
    return c.json({ data: record }, 201)
  })

  // PATCH /:id — update record
  router.patch('/:id', async (c) => {
    const id = c.req.param('id')
    const body = await c.req.json()

    // Validate with Zod (partial)
    const validation = zodSchemas.update.safeParse(body)
    if (!validation.success) {
      return c.json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid request data',
          details: validation.error.issues,
        },
      }, 400)
    }

    const record = await update(collection, id, validation.data as Record<string, any>)
    if (!record) {
      return c.json({ error: { code: 'NOT_FOUND', message: 'Record not found' } }, 404)
    }

    return c.json({ data: record })
  })

  // DELETE /:id — delete (soft by default)
  router.delete('/:id', async (c) => {
    const id = c.req.param('id')
    const hard = c.req.query('hard') === 'true'
    const deleted = await remove(collection, id, !hard)

    if (!deleted) {
      return c.json({ error: { code: 'NOT_FOUND', message: 'Record not found' } }, 404)
    }

    return c.json({ data: { id, deleted: true, soft: !hard } })
  })

  return router
}

/**
 * Parse the filter query parameter.
 * Supports: ?filter[field]=value (from query string)
 * Also supports: ?filter={"field":"value"} (JSON)
 */
function parseFilterParam(filter?: string): Record<string, string> | undefined {
  if (!filter) return undefined

  // Try JSON parse first
  try {
    const parsed = JSON.parse(filter)
    if (typeof parsed === 'object' && parsed !== null) {
      return parsed
    }
  } catch {
    // Not JSON — fall through
  }

  return undefined
}
