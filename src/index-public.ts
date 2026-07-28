/**
 * Base — Public API exports
 * Import from your app: `import { defineCollection, f } from '@base/core'`
 */

// Schema definition
export { defineCollection, f } from './schema/define.js'
export type {
  CollectionSchema,
  FieldSchema,
  FieldType,
  IndexSchema,
  CollectionAccess,
  AccessLevel,
} from './schema/types.js'

// Registry
export {
  register,
  getRegisteredCollections,
  validateRegistry,
  clearRegistry,
} from './schema/registry.js'

// Auth middleware (for custom routes)
export { requireAuth, optionalAuth } from './auth/middleware.js'

// App factory
export { createApp } from './server/hono-app.js'
