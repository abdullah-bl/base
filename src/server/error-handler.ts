import type { ErrorHandler } from 'hono';
import { ZodError } from 'zod';

export const errorHandler: ErrorHandler = (err, c) => {
  console.error('❌ Error:', err);

  // Handle Zod validation errors
  if (err instanceof ZodError) {
    return c.json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid request data',
        details: err.issues,
      },
    }, 400);
  }

  // Handle generic errors
  const statusCode = (err as any).status || (err as any).statusCode || 500;
  const message = err instanceof Error ? err.message : 'Internal server error';

  return c.json({
    error: {
      code: 'INTERNAL_ERROR',
      message,
    },
  }, statusCode);
};