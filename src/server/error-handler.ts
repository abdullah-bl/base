import type { ErrorHandler } from 'hono'
import { ZodError } from 'zod'
import env from '../env.js'
import { logger } from '../observability/logger.js'

export const errorHandler: ErrorHandler = (err, c) => {
  let requestId: string | undefined
  try {
    requestId = c.get('requestId' as never) as string | undefined
  } catch {
    requestId = undefined
  }

  logger.error('error', err instanceof Error ? err.message : 'Unknown error', {
    requestId,
    path: c.req.path,
    method: c.req.method,
    meta: {
      stack: err instanceof Error ? err.stack : undefined,
      name: err instanceof Error ? err.name : undefined,
    },
  })

  if (err instanceof ZodError) {
    return c.json(
      {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid request data',
          details: err.issues,
          requestId,
        },
      },
      400,
    )
  }

  const e = err as Error & { status?: number; statusCode?: number; code?: string }
  const statusCode = e.status || e.statusCode || 500

  // Domain errors with explicit codes may expose their message
  if (e.code && statusCode < 500) {
    return c.json(
      {
        error: {
          code: e.code,
          message: e.message,
          requestId,
        },
      },
      statusCode as any,
    )
  }

  // Never leak internal exception messages for 500s
  const message =
    env.NODE_ENV === 'development' && statusCode >= 500
      ? e.message || 'Internal server error'
      : statusCode >= 500
        ? 'Internal server error'
        : e.message || 'Request failed'

  return c.json(
    {
      error: {
        code: statusCode >= 500 ? 'INTERNAL_ERROR' : e.code || 'REQUEST_ERROR',
        message,
        requestId,
      },
    },
    statusCode as any,
  )
}
