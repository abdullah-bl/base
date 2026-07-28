import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { optionalAuth } from '../auth/middleware.js'
import {
  getAccessLevel,
  type AuthUser,
} from '../collections/access.js'
import { getRegisteredCollections } from '../schema/registry.js'
import env from '../env.js'
import { subscribe, type ChangeEvent } from './bus.js'

const HEARTBEAT_MS = 15_000

/**
 * GET /api/realtime?collections=posts,comments
 *
 * SSE stream of collection-change events, filtered by each collection's
 * read access policy. One connection multiplexes multiple collections.
 */
export function createRealtimeRouter(): Hono {
  const router = new Hono()

  router.use('*', optionalAuth)

  router.get('/', async (c) => {
    if (!env.REALTIME_ENABLED) {
      return c.json(
        {
          error: {
            code: 'REALTIME_DISABLED',
            message: 'Realtime subscriptions are disabled',
          },
        },
        503,
      )
    }

    const raw = c.req.query('collections') || ''
    const names = raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)

    if (names.length === 0) {
      return c.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message:
              'Query parameter "collections" is required (comma-separated collection names)',
          },
        },
        400,
      )
    }

    const registered = new Map(
      getRegisteredCollections().map((col) => [col.name, col]),
    )
    const user = (c.get('user' as never) as AuthUser | undefined) ?? null

    for (const name of names) {
      const collection = registered.get(name)
      if (!collection || name === 'user' || name === 'users') {
        return c.json(
          {
            error: {
              code: 'VALIDATION_ERROR',
              message: `Unknown collection: ${name}`,
            },
          },
          400,
        )
      }

      const level = getAccessLevel(collection, 'read')
      if (level !== 'public' && !user?.id) {
        return c.json(
          {
            error: {
              code: 'UNAUTHORIZED',
              message: `Authentication required to subscribe to "${name}"`,
            },
          },
          401,
        )
      }
    }

    const lastEventId =
      c.req.header('Last-Event-ID') || c.req.query('lastEventId') || undefined

    c.header('X-Accel-Buffering', 'no')
    c.header('Cache-Control', 'no-cache')

    return streamSSE(c, async (stream) => {
      let closed = false
      let heartbeat: ReturnType<typeof setInterval> | undefined

      const unsubscribe = subscribe({
        collections: names,
        user,
        lastEventId,
        resolveCollection: (name) => registered.get(name),
        onEvent: (event: ChangeEvent) => {
          if (closed) return
          void stream
            .writeSSE({
              event: 'change',
              id: event.id,
              data: JSON.stringify(event),
            })
            .catch(() => {
              closed = true
            })
        },
        onClose: () => {
          closed = true
          if (heartbeat) clearInterval(heartbeat)
          void stream.close()
        },
      })

      stream.onAbort(() => {
        closed = true
        if (heartbeat) clearInterval(heartbeat)
        unsubscribe()
      })

      await stream.writeSSE({
        event: 'open',
        data: JSON.stringify({ collections: names }),
      })

      heartbeat = setInterval(() => {
        if (closed) return
        void stream.writeSSE({ event: 'heartbeat', data: '' }).catch(() => {
          closed = true
          if (heartbeat) clearInterval(heartbeat)
          unsubscribe()
        })
      }, HEARTBEAT_MS)

      // Keep the streamSSE callback alive until the client disconnects
      await new Promise<void>((resolve) => {
        const check = setInterval(() => {
          if (closed) {
            clearInterval(check)
            resolve()
          }
        }, 500)
        stream.onAbort(() => {
          clearInterval(check)
          resolve()
        })
      })

      if (heartbeat) clearInterval(heartbeat)
      unsubscribe()
    })
  })

  return router
}
