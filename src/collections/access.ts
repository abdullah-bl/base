import type { AccessLevel, CollectionSchema } from '../schema/types.js'
import env from '../env.js'

export class ForbiddenError extends Error {
  status = 403
  code = 'FORBIDDEN'

  constructor(message = 'Forbidden') {
    super(message)
    this.name = 'ForbiddenError'
  }
}

export interface AuthUser {
  id: string
  [key: string]: unknown
}

export interface AccessContext {
  user: AuthUser | null
}

function defaultLevel(): AccessLevel {
  return 'authenticated'
}

export function getAccessLevel(
  collection: CollectionSchema,
  operation: 'create' | 'read' | 'update' | 'delete',
): AccessLevel {
  return collection.access?.[operation] ?? defaultLevel()
}

export function warnMissingAccessPolicies(collections: CollectionSchema[]): void {
  if (env.NODE_ENV !== 'production') return
  for (const collection of collections) {
    if (!collection.access) {
      console.warn(
        `⚠️  Collection "${collection.name}" has no explicit access policy — defaulting to authenticated-only for all operations.`,
      )
    }
  }
}

/**
 * Pure read-access predicate shared by HTTP get/list and SSE fan-out.
 * Returns true when `user` may see `record` under the collection's read policy.
 */
export function canReadRecord(
  collection: CollectionSchema,
  user: AuthUser | null,
  record: Record<string, unknown>,
): boolean {
  const level = getAccessLevel(collection, 'read')
  if (level === 'public') return true
  if (!user?.id) return false
  if (level === 'authenticated') return true
  const ownerField = collection.access?.ownerField
  if (!ownerField) return false
  return record[ownerField] === user.id
}

/**
 * Ensure the caller may perform an operation. Throws ForbiddenError on denial.
 * For `owner` rules on read/update/delete of a specific record, pass the record.
 */
export function assertAccess(
  collection: CollectionSchema,
  operation: 'create' | 'read' | 'update' | 'delete',
  ctx: AccessContext,
  record?: Record<string, unknown> | null,
): void {
  const level = getAccessLevel(collection, operation)

  if (level === 'public') return

  if (!ctx.user?.id) {
    throw new ForbiddenError('Authentication required')
  }

  if (level === 'authenticated') return

  // owner
  const ownerField = collection.access?.ownerField
  if (!ownerField) {
    throw new ForbiddenError('Owner field not configured')
  }

  if (operation === 'create') {
    // Owner is set server-side; create is allowed for authenticated users
    return
  }

  // List / pre-fetch path: ownership is enforced via SQL filter (ownerFilterSql)
  if (!record) {
    return
  }

  // For read, share the predicate with SSE. For update/delete, owner-field match.
  if (operation === 'read') {
    if (!canReadRecord(collection, ctx.user, record)) {
      throw new ForbiddenError('Not your record')
    }
    return
  }

  if (record[ownerField] !== ctx.user.id) {
    throw new ForbiddenError('Not your record')
  }
}

/**
 * Apply ownership on create: force ownerField to current user when rule is owner.
 */
export function applyOwnerOnCreate(
  collection: CollectionSchema,
  data: Record<string, unknown>,
  user: AuthUser,
): Record<string, unknown> {
  const level = getAccessLevel(collection, 'create')
  const ownerField = collection.access?.ownerField
  if (level === 'owner' && ownerField) {
    return { ...data, [ownerField]: user.id }
  }
  // Even for authenticated create with ownerField, prefer binding to user if client omits/spoofs
  if (ownerField && collection.access?.update === 'owner') {
    return { ...data, [ownerField]: user.id }
  }
  return data
}

/**
 * SQL fragment + args to restrict list/get queries for owner-level read.
 * Returns null when no extra constraint is needed.
 */
export function ownerFilterSql(
  collection: CollectionSchema,
  operation: 'read' | 'update' | 'delete',
  user: AuthUser | null,
): { sql: string; args: unknown[] } | null {
  const level = getAccessLevel(collection, operation)
  if (level !== 'owner') return null
  if (!user?.id) {
    throw new ForbiddenError('Authentication required')
  }
  const ownerField = collection.access!.ownerField!
  return { sql: `"${ownerField}" = ?`, args: [user.id] }
}
