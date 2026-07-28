import { getClient } from '../db/client.js'
import type { CollectionSchema, FieldSchema } from '../schema/types.js'

const ensuredTables = new Set<string>()

/**
 * Ensure a collection's table exists in the database.
 * Creates it with CREATE TABLE IF NOT EXISTS if needed.
 * Idempotent — only checks once per table per process.
 */
export async function ensureCollectionTable(
  collection: CollectionSchema,
): Promise<void> {
  if (ensuredTables.has(collection.name)) return

  const client = getClient()
  const ddl = buildCreateTableDDL(collection)
  await client.execute(ddl)

  for (const index of collection.indexes) {
    const indexName =
      index.name || `idx_${collection.name}_${index.fields.join('_')}`
    const unique = index.unique ? 'UNIQUE' : ''
    const cols = index.fields.map((f) => `"${f}"`).join(', ')
    try {
      await client.execute(
        `CREATE ${unique} INDEX IF NOT EXISTS "${indexName}" ON "${collection.name}" (${cols})`,
      )
    } catch (err) {
      // Unique indexes are required for correctness — fail hard
      if (index.unique) {
        throw new Error(
          `Failed to create unique index "${indexName}" on "${collection.name}": ${err instanceof Error ? err.message : String(err)}`,
        )
      }
      console.warn(`⚠️  Index creation failed for ${indexName}:`, err)
    }
  }

  ensuredTables.add(collection.name)
  console.log(`✅ Table ensured: ${collection.name}`)
}

export function resetEnsuredTables(): void {
  ensuredTables.clear()
}

export function buildCreateTableDDL(collection: CollectionSchema): string {
  const columns: string[] = [
    `"id" TEXT PRIMARY KEY NOT NULL`,
    `"createdAt" INTEGER NOT NULL DEFAULT 0`,
    `"updatedAt" INTEGER NOT NULL DEFAULT 0`,
    `"deletedAt" INTEGER`,
  ]

  for (const [fieldName, field] of Object.entries(collection.fields)) {
    columns.push(buildColumnDef(fieldName, field))
  }

  return `CREATE TABLE IF NOT EXISTS "${collection.name}" (\n  ${columns.join(',\n  ')}\n)`
}

export function buildColumnDef(fieldName: string, field: FieldSchema): string {
  const sqlType = getSqliteType(field.type)
  let def = `"${fieldName}" ${sqlType}`

  if (field.required) {
    def += ' NOT NULL'
  }
  if (field.unique) {
    def += ' UNIQUE'
  }
  if (field.default !== undefined) {
    def += ` DEFAULT ${formatDefault(field.default, field.type)}`
  }

  return def
}

export function getSqliteType(fieldType: string): string {
  switch (fieldType) {
    case 'integer':
    case 'boolean':
    case 'date':
      return 'INTEGER'
    case 'real':
      return 'REAL'
    case 'string':
    case 'text':
    case 'json':
    case 'reference':
    case 'vector':
    default:
      return 'TEXT'
  }
}

export function formatDefault(value: unknown, fieldType: string): string {
  if (fieldType === 'boolean') {
    return value ? '1' : '0'
  }
  if (typeof value === 'number') {
    return String(value)
  }
  if (typeof value === 'string') {
    return `'${value.replace(/'/g, "''")}'`
  }
  return 'NULL'
}
