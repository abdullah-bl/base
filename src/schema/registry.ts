import type { CollectionSchema } from './types.js'

/**
 * Single source of truth for registered collections.
 * defineCollection() writes here; the server mounts routes from here.
 */
const collectionRegistry = new Map<string, CollectionSchema>()

/**
 * Register a collection in the registry.
 * @throws Error if collection name already exists
 */
export function registerCollection(collection: CollectionSchema): void {
  const name = collection.name

  if (collectionRegistry.has(name)) {
    throw new Error(`Collection "${name}" is already defined`)
  }

  if (collection.access) {
    const levels = [
      collection.access.create,
      collection.access.read,
      collection.access.update,
      collection.access.delete,
    ]
    if (levels.some((l) => l === 'owner') && !collection.access.ownerField) {
      throw new Error(
        `Collection "${name}" uses owner access but access.ownerField is missing`,
      )
    }
    if (
      collection.access.ownerField &&
      !collection.fields[collection.access.ownerField] &&
      collection.access.ownerField !== 'id'
    ) {
      throw new Error(
        `Collection "${name}" access.ownerField "${collection.access.ownerField}" does not exist`,
      )
    }
  }

  collectionRegistry.set(name, collection)
}

/** Alias used by collections.ts / public API */
export function register(collection: CollectionSchema): void {
  // Idempotent for the public register() path when defineCollection already registered
  if (collectionRegistry.has(collection.name)) {
    const existing = collectionRegistry.get(collection.name)!
    if (existing !== collection) {
      // Same name already registered (typically by defineCollection) — update in place
      collectionRegistry.set(collection.name, collection)
    }
    return
  }
  registerCollection(collection)
}

export function getCollection(name: string): CollectionSchema | undefined {
  return collectionRegistry.get(name)
}

export function getAllCollections(): CollectionSchema[] {
  return Array.from(collectionRegistry.values())
}

/** Alias for server route mounting */
export function getRegisteredCollections(): CollectionSchema[] {
  return getAllCollections()
}

/**
 * Validate the entire registry:
 * - reference integrity
 * - index field existence
 * - index name uniqueness
 * - access rule consistency
 */
export function validateRegistry(): void {
  const collections = getAllCollections()

  for (const collection of collections) {
    for (const [fieldName, field] of Object.entries(collection.fields)) {
      if (field.type === 'reference') {
        const target = field.ref
        if (!target) {
          throw new Error(
            `Reference field "${collection.name}.${fieldName}" missing target collection`,
          )
        }
        // Better Auth table is "user" (singular); also allow registered collections
        if (
          target !== 'user' &&
          target !== 'users' &&
          !collectionRegistry.has(target)
        ) {
          throw new Error(
            `Reference field "${collection.name}.${fieldName}" points to non-existent collection "${target}"`,
          )
        }
      }
    }
  }

  for (const collection of collections) {
    const indexNames = new Set<string>()

    for (const index of collection.indexes) {
      if (index.name) {
        if (indexNames.has(index.name)) {
          throw new Error(
            `Duplicate index name "${index.name}" in collection "${collection.name}"`,
          )
        }
        indexNames.add(index.name)
      }

      for (const fieldName of index.fields) {
        if (
          !collection.fields[fieldName] &&
          fieldName !== 'id' &&
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

export function clearRegistry(): void {
  collectionRegistry.clear()
}

/** Replace or insert a collection (used by DB-backed schema reload). */
export function upsertCollection(collection: CollectionSchema): void {
  if (collectionRegistry.has(collection.name)) {
    collectionRegistry.set(collection.name, collection)
    return
  }
  registerCollection(collection)
}

export function removeCollection(name: string): boolean {
  return collectionRegistry.delete(name)
}

/**
 * Auto-register the Better Auth user table as a reference target.
 * Better Auth uses the table name "user" (singular).
 */
export function ensureUsersCollection(): void {
  if (!collectionRegistry.has('user') && !collectionRegistry.has('users')) {
    const usersCollection: CollectionSchema = {
      name: 'user',
      fields: {
        email: { type: 'string', required: false, optional: true, unique: true },
        name: { type: 'string', required: false, optional: true, unique: false },
        image: { type: 'string', required: false, optional: true, unique: false },
      },
      indexes: [{ fields: ['email'], unique: true }],
    }
    collectionRegistry.set('user', usersCollection)
  }
}
