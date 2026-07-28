// Field types
export type FieldType = 'string' | 'text' | 'integer' | 'real' | 'boolean' | 'date' | 'json' | 'reference' | 'vector'

export interface FieldSchema {
  type: FieldType
  required: boolean
  optional: boolean
  unique: boolean
  default?: unknown
  max?: number
  min?: number
  ref?: string          // for reference type: target collection name
  vectorSize?: number   // for vector type: dimension count
}

export interface IndexSchema {
  fields: string[]
  name?: string
  unique?: boolean
}

export interface CollectionSchema {
  name: string
  fields: Record<string, FieldSchema>
  indexes: IndexSchema[]
}

// System columns auto-added to every collection
export const SYSTEM_COLUMNS = {
  id: 'id',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
  deletedAt: 'deletedAt',
} as const