/**
 * Backward-compatible re-exports.
 * The single registry lives in registry.ts — do not maintain a second list.
 */
export {
  register,
  getRegisteredCollections,
  getAllCollections,
  clearRegistry,
  validateRegistry,
  ensureUsersCollection,
} from './registry.js'
