import { Hono } from 'hono'
import { corsMiddleware } from './cors.js'
import { errorHandler } from './error-handler.js'
import { authHandler } from '../auth/handler.js'
import { requireAuth } from '../auth/middleware.js'

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

// Better Auth routes — handles sign-up, sign-in, sign-out, etc.
app.all('/api/auth/*', async (c) => {
  return await authHandler(c.req.raw)
})

// Protected: get current session user
app.get('/api/auth/me', requireAuth, (c) => {
  const user = c.get('user' as never) as any
  return c.json({ user })
})

export default app
