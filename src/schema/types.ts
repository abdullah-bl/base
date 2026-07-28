// Field types
export type FieldType =
  | 'string'
  | 'text'
  | 'integer'
  | 'real'
  | 'boolean'
  | 'date'
  | 'json'
  | 'reference'
  | 'vector'

export type AccessLevel = 'public' | 'authenticated' | 'owner'

export interface FieldSchema {
  type: FieldType
  required: boolean
  optional: boolean
  unique: boolean
  default?: unknown
  max?: number
  min?: number
  ref?: string // for reference type: target collection name
  vectorSize?: number // for vector type: dimension count
}

export interface IndexSchema {
  fields: string[]
  name?: string
  unique?: boolean
}

/**
 * Compact RLS-lite access rules for a collection.
 * Default (undefined) preserves authenticated-only behavior for all ops.
 */
export interface CollectionAccess {
  create?: AccessLevel
  read?: AccessLevel
  update?: AccessLevel
  delete?: AccessLevel
  /** Field containing the owning user id (required when any rule is `owner`) */
  ownerField?: string
}

export interface CollectionSchema {
  name: string
  fields: Record<string, FieldSchema>
  indexes: IndexSchema[]
  access?: CollectionAccess
}

// System columns auto-added to every collection
export const SYSTEM_COLUMNS = {
  id: 'id',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
  deletedAt: 'deletedAt',
} as const
