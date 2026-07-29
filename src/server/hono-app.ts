import { Hono } from 'hono'
import { corsMiddleware } from './cors.js'
import { errorHandler } from './error-handler.js'
import { rateLimitMiddleware } from './rate-limit.js'
import { authHandler } from '../auth/handler.js'
import { requireAuth } from '../auth/middleware.js'
import {
  createDynamicCollectionsRouter,
  listMountedCollectionNames,
} from '../collections/dynamic-router.js'
import {
  getRegisteredCollections,
  validateRegistry,
  ensureUsersCollection,
} from '../schema/registry.js'
import { warnMissingAccessPolicies } from '../collections/access.js'
import filesRouter from '../files/router.js'
import { createRealtimeRouter } from '../realtime/router.js'
import { createAdminRouter } from '../admin/router.js'
import { mountAdminUi } from '../admin/static.js'
import { mountOnboardingRoutes } from '../admin/control-plane.js'
import { requestLogMiddleware } from '../observability/request-log.js'
import { initLogBus } from '../observability/bus.js'
import { generateOpenApiSpec } from '../openapi/generate.js'
import { getClient } from '../db/client.js'
import env from '../env.js'
import { isMaintenanceMode, getMaintenanceReason } from './maintenance.js'
import { isDraining } from './restart.js'
import { getEffectiveRuntime } from '../settings/resolve.js'

export function createApp(): Hono {
  ensureUsersCollection()
  validateRegistry()
  initLogBus()

  const collections = getRegisteredCollections().filter(
    (c) => c.name !== 'user' && c.name !== 'users',
  )
  warnMissingAccessPolicies(collections)

  const app = new Hono()

  // Request ID + structured HTTP logs first
  app.use('*', requestLogMiddleware)
  app.use('*', corsMiddleware)
  app.use('*', rateLimitMiddleware)
  app.onError(errorHandler)

  app.get('/api/health', (c) => {
    return c.json({
      status: isDraining()
        ? 'draining'
        : isMaintenanceMode()
          ? 'maintenance'
          : 'ok',
      timestamp: new Date().toISOString(),
      version: '0.1.0',
      uptime: process.uptime(),
    })
  })

  app.get('/api/health/live', (c) => {
    return c.json({ status: 'live' })
  })

  app.get('/api/health/ready', async (c) => {
    try {
      await getClient().execute('SELECT 1')
      if (isDraining()) {
        return c.json(
          { status: 'not_ready', reason: 'Server is restarting' },
          503,
        )
      }
      if (isMaintenanceMode()) {
        return c.json(
          {
            status: 'not_ready',
            reason: getMaintenanceReason(),
          },
          503,
        )
      }
      return c.json({ status: 'ready' })
    } catch (err) {
      return c.json(
        {
          status: 'not_ready',
          reason: err instanceof Error ? err.message : 'db error',
        },
        503,
      )
    }
  })

  app.get('/api/openapi.json', async (c) => {
    let baseUrl = env.BETTER_AUTH_URL
    try {
      const runtime = await getEffectiveRuntime()
      baseUrl = runtime.publicUrl || baseUrl
    } catch {
      // ignore
    }
    return c.json(generateOpenApiSpec(baseUrl))
  })

  // Onboarding + public auth providers (no admin gate)
  mountOnboardingRoutes(app)

  app.get('/api/auth/me', requireAuth, (c) => {
    const user = c.get('user' as never) as any
    return c.json({ user })
  })

  app.all('/api/auth/*', async (c) => {
    return await authHandler(c.req.raw)
  })

  // Dynamic collection dispatcher — schema resolved per request from registry
  app.route('/api/collections', createDynamicCollectionsRouter())

  const names = listMountedCollectionNames()
  if (names.length > 0) {
    console.log(`📦 Collections ready: ${names.join(', ')}`)
  }

  app.route('/api/files', filesRouter)
  app.route('/api/realtime', createRealtimeRouter())

  if (env.ADMIN_ENABLED) {
    app.route('/api/admin', createAdminRouter())
    mountAdminUi(app)
  }

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
