import type { CollectionSchema } from './types.js'

/**
 * Collections are registered here by the user's collections.ts file.
 * The server reads this list on startup to mount CRUD routes.
 */

export const registeredCollections: CollectionSchema[] = []

export function register(collection: CollectionSchema): void {
  // Avoid duplicates
  const exists = registeredCollections.some(c => c.name === collection.name)
  if (!exists) {
    registeredCollections.push(collection)
  }
}

export function getRegisteredCollections(): CollectionSchema[] {
  return registeredCollections
}
