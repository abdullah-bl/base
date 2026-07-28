import { Hono } from 'hono'
import { corsMiddleware } from './cors.js'
import { errorHandler } from './error-handler.js'
import { authHandler } from '../auth/handler.js'
import { requireAuth } from '../auth/middleware.js'
import { createCollectionRouter } from '../collections/router.js'
import {
  getRegisteredCollections,
  validateRegistry,
  ensureUsersCollection,
} from '../schema/registry.js'
import { warnMissingAccessPolicies } from '../collections/access.js'
import filesRouter from '../files/router.js'
import { createRealtimeRouter } from '../realtime/router.js'

export function createApp(): Hono {
  ensureUsersCollection()
  validateRegistry()

  const collections = getRegisteredCollections().filter(
    (c) => c.name !== 'user' && c.name !== 'users',
  )
  warnMissingAccessPolicies(collections)

  const app = new Hono()

  app.use('*', corsMiddleware)
  app.onError(errorHandler)

  app.get('/api/health', (c) => {
    return c.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: '0.1.0',
      uptime: process.uptime(),
    })
  })

  app.get('/api/auth/me', requireAuth, (c) => {
    const user = c.get('user' as never) as any
    return c.json({ user })
  })

  app.all('/api/auth/*', async (c) => {
    return await authHandler(c.req.raw)
  })

  for (const collection of collections) {
    app.route(
      `/api/collections/${collection.name}`,
      createCollectionRouter(collection),
    )
  }

  if (collections.length > 0) {
    console.log(
      `📦 Mounted ${collections.length} collection(s): ${collections.map((c) => c.name).join(', ')}`,
    )
  }

  app.route('/api/files', filesRouter)
  app.route('/api/realtime', createRealtimeRouter())

  return app
}

/** Lazy default for convenience imports */
let defaultApp: Hono | null = null
export function getDefaultApp(): Hono {
  if (!defaultApp) defaultApp = createApp()
  return defaultApp
}

export function resetDefaultAppForTests(): void {
  defaultApp = null
}

export default new Proxy({} as Hono, {
  get(_target, prop, receiver) {
    const app = getDefaultApp()
    const value = Reflect.get(app as object, prop, receiver)
    return typeof value === 'function' ? value.bind(app) : value
  },
})
