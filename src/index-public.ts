/**
 * Base — Public API exports
 * Import from your app: `import { defineCollection, f } from '@base/core'`
 */

// Schema definition
export { defineCollection, f } from './schema/define.js'
export type { CollectionSchema, FieldSchema, FieldType, IndexSchema } from './schema/types.js'

// Registry (for advanced use)
export { register, getRegisteredCollections } from './schema/index-registry.js'

// Auth middleware (for custom routes)
export { requireAuth, optionalAuth } from './auth/middleware.js'

// Types
export type { default as HonoApp } from './server/hono-app.js'
