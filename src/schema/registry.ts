import type { CollectionSchema } from './types.js'

/**
 * Internal registry storage for collections
 */
const collectionRegistry = new Map<string, CollectionSchema>()

/**
 * Register a collection in the registry
 * @param collection - Collection schema to register
 * @throws Error if collection name already exists
 */
export function registerCollection(collection: CollectionSchema): void {
  const name = collection.name

  // Check for duplicate collection names
  if (collectionRegistry.has(name)) {
    throw new Error(`Collection "${name}" is already defined`)
  }

  collectionRegistry.set(name, collection)
}

/**
 * Get a collection by name
 * @param name - Collection name
 * @returns CollectionSchema or undefined if not found
 */
export function getCollection(name: string): CollectionSchema | undefined {
  return collectionRegistry.get(name)
}

/**
 * Get all registered collections
 * @returns Array of all CollectionSchema objects
 */
export function getAllCollections(): CollectionSchema[] {
  return Array.from(collectionRegistry.values())
}

/**
 * Validate the entire registry
 * Checks for:
 * - No duplicate collection names (already handled in registerCollection)
 * - All reference fields point to existing collections or 'users'
 * - All index fields exist in the collection's field definitions
 * - Index names are unique within a collection
 * @throws Error if validation fails
 */
export function validateRegistry(): void {
  const collections = getAllCollections()

  // Check that all reference fields point to existing collections
  for (const collection of collections) {
    for (const [fieldName, field] of Object.entries(collection.fields)) {
      if (field.type === 'reference') {
        const target = field.ref
        if (!target) {
          throw new Error(
            `Reference field "${collection.name}.${fieldName}" missing target collection`,
          )
        }
        // Allow references to 'users' (auto-created by Better Auth) or registered collections
        if (target !== 'users' && !collectionRegistry.has(target)) {
          throw new Error(
            `Reference field "${collection.name}.${fieldName}" points to non-existent collection "${target}"`,
          )
        }
      }
    }
  }

  // Check that all index fields exist in their collection
  for (const collection of collections) {
    const indexNames = new Set<string>()

    for (const index of collection.indexes) {
      // Check index name uniqueness within collection
      if (index.name) {
        if (indexNames.has(index.name)) {
          throw new Error(
            `Duplicate index name "${index.name}" in collection "${collection.name}"`,
          )
        }
        indexNames.add(index.name)
      }

      // Check that all indexed fields exist
      for (const fieldName of index.fields) {
        if (
          !collection.fields[fieldName] &&
          fieldName !== 'id' && // Allow indexing system columns
          fieldName !== 'createdAt' &&
          fieldName !== 'updatedAt' &&
          fieldName !== 'deletedAt'
        ) {
          throw new Error(
            `Index in collection "${collection.name}" references non-existent field "${fieldName}"`,
          )
        }
      }
    }
  }
}

/**
 * Clear all collections from the registry
 * Useful for testing
 */
export function clearRegistry(): void {
  collectionRegistry.clear()
}

/**
 * Auto-register the 'users' collection if not defined
 * This is created by Better Auth, so we need it in our registry
 */
export function ensureUsersCollection(): void {
  if (!collectionRegistry.has('users')) {
    const usersCollection: CollectionSchema = {
      name: 'users',
      fields: {
        email: { type: 'string', required: false, optional: true, unique: false },
        name: { type: 'string', required: false, optional: true, unique: false },
        image: { type: 'string', required: false, optional: true, unique: false },
      },
      indexes: [{ fields: ['email'], unique: true }],
    }
    collectionRegistry.set('users', usersCollection)
  }
}