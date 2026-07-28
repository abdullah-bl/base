import { Hono } from 'hono'
import { corsMiddleware } from './cors.js'
import { errorHandler } from './error-handler.js'
import { authHandler } from '../auth/handler.js'
import { requireAuth } from '../auth/middleware.js'
import { createCollectionRouter } from '../collections/router.js'
import { getRegisteredCollections } from '../schema/index-registry.js'

const app = new Hono()

// Apply CORS middleware
app.use('*', corsMiddleware)

// Apply error handler
app.onError(errorHandler)

// Health check endpoint
app.get('/api/health', (c) => {
  return c.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '0.1.0',
    uptime: process.uptime(),
  })
})

// Protected: get current session user (before wildcard to take priority)
app.get('/api/auth/me', requireAuth, (c) => {
  const user = c.get('user' as never) as any
  return c.json({ user })
})

// Better Auth routes — handles sign-up, sign-in, sign-out, etc.
app.all('/api/auth/*', async (c) => {
  return await authHandler(c.req.raw)
})

// Mount collection CRUD routers
const collections = getRegisteredCollections()
for (const collection of collections) {
  app.route(`/api/collections/${collection.name}`, createCollectionRouter(collection))
}

if (collections.length > 0) {
  console.log(`📦 Mounted ${collections.length} collection(s): ${collections.map(c => c.name).join(', ')}`)
}

export default app
