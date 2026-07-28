import { getAuth } from './auth.js'

/**
 * Better Auth route handler.
 * Pass the raw Request from Hono context to Better Auth.
 */
export function authHandler(req: Request): Promise<Response> {
  return getAuth().handler(req) as Promise<Response>
}
