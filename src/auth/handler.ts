import { auth } from './auth.js'

/**
 * Better Auth route handler.
 * Pass the raw Request from Hono context to Better Auth.
 *
 * Usage in Hono:
 *   app.all('/api/auth/*', (c) => authHandler(c.req.raw))
 */
export function authHandler(req: Request): Promise<Response> {
  return auth.handler(req) as Promise<Response>
}
