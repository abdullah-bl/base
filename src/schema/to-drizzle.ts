import type { CollectionSchema, FieldSchema } from './types.js'
import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core'

/**
 * Convert schema collections to Drizzle table definitions
 * @param collections - Array of CollectionSchema objects
 * @returns Record mapping collection names to Drizzle SQLiteTable objects
 */
export function schemaToDrizzle(
  collections: CollectionSchema[],
): Record<string, any> {
  const tables: Record<string, any> = {}

  for (const collection of collections) {
    tables[collection.name] = buildDrizzleTable(collection)
  }

  return tables
}

/**
 * Build a single Drizzle table from a collection schema
 * @param collection - Collection schema
 * @returns Drizzle SQLiteTable
 */
function buildDrizzleTable(collection: CollectionSchema): any {
  return sqliteTable(collection.name, (t) => {
    // Define all columns
    const schema: any = {}

    // Add system columns
    schema.id = t.text('id').primaryKey()
    schema.createdAt = t.integer('createdAt').notNull().default(new Date().getTime())
    schema.updatedAt = t.integer('updatedAt').notNull().default(new Date().getTime())
    schema.deletedAt = t.integer('deletedAt') // nullable

    // Add user-defined fields
    for (const [fieldName, field] of Object.entries(collection.fields)) {
      schema[fieldName] = buildDrizzleColumn(fieldName, field, t)
    }

    return schema
  })
}

/**
 * Build a single Drizzle column from a field schema
 * @param fieldName - Name of the field
 * @param field - Field schema
 * @param t - Drizzle column type builder
 * @returns Drizzle column definition
 */
function buildDrizzleColumn(fieldName: string, field: FieldSchema, t: any): any {
  let column: any

  // Map field types to Drizzle column types
  switch (field.type) {
    case 'string':
    case 'text':
      column = t.text(fieldName)
      break

    case 'integer':
      column = t.integer(fieldName)
      break

    case 'real':
      column = t.real(fieldName)
      break

    case 'boolean':
      // SQLite doesn't have native boolean, use integer with mode
      column = t.integer(fieldName, { mode: 'boolean' })
      break

    case 'date':
      // Store dates as millisecond timestamps
      column = t.integer(fieldName, { mode: 'timestamp_ms' })
      break

    case 'json':
      // Store JSON as text with json mode
      column = t.text(fieldName, { mode: 'json' })
      break

    case 'reference':
      // References are stored as text (ULID strings)
      column = t.text(fieldName)
      break

    case 'vector':
      // Vectors stored as serialized text (for now, until sqlite-vec in Phase 7)
      column = t.text(fieldName)
      break

    default:
      throw new Error(`Unknown field type: ${field.type}`)
  }

  // Apply nullability
  if (field.required) {
    column = column.notNull()
  }
  // Note: fields are nullable by default in SQLite/Drizzle

  // Apply default value
  if (field.default !== undefined) {
    // Convert some defaults for SQLite
    let defaultValue = field.default

    // Boolean default: convert to 0/1 for SQLite
    if (field.type === 'boolean' && typeof defaultValue === 'boolean') {
      defaultValue = defaultValue ? 1 : 0
    }

    // Date default: convert to timestamp
    if (field.type === 'date' && defaultValue instanceof Date) {
      defaultValue = defaultValue.getTime()
    }

    // Apply default
    column = column.default(defaultValue)
  }

  // Apply unique constraint
  if (field.unique) {
    column = column.unique()
  }

  // Note: .max() and .min() for string fields are handled in Zod validation,
  // not at database level (SQLite TEXT has no max length)

  return column
}