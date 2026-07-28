import { db } from '../db/client.js'
import { schema } from '../db/schema.js'
import { sql, eq, and, isNull, desc, asc, like, type SQL } from 'drizzle-orm'
import { ulid } from 'ulid'
import type { CollectionSchema } from '../schema/types.js'
import { config } from '../config.js'
import { ensureCollectionTable } from './table-create.js'

/**
 * Generic CRUD operations for any collection.
 * Tables are created on-demand from the schema definition.
 */

export async function create(collection: CollectionSchema, data: Record<string, any>) {
  const tableName = collection.name
  await ensureCollectionTable(collection)

  const now = Date.now()
  const record: Record<string, any> = {
    id: ulid(),
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  }

  // Apply user fields + defaults
  for (const [fieldName, field] of Object.entries(collection.fields)) {
    if (fieldName in data) {
      record[fieldName] = data[fieldName]
    } else if (field.default !== undefined) {
      record[fieldName] = field.default
    } else if (field.required) {
      throw new Error(`Missing required field: ${fieldName}`)
    }
  }

  // Insert using raw SQL (since tables are dynamic)
  const columns = Object.keys(record).map(c => `"${c}"`).join(', ')
  const placeholders = Object.keys(record).map(() => '?').join(', ')
  const values = Object.values(record)

  const client = (db as any).$client
  await client.execute({
    sql: `INSERT INTO "${tableName}" (${columns}) VALUES (${placeholders})`,
    args: values,
  })

  return { id: record.id, ...stripSystemDefaults(record, collection) }
}

export async function getById(collection: CollectionSchema, id: string) {
  await ensureCollectionTable(collection)
  const client = (db as any).$client

  const result = await client.execute({
    sql: `SELECT * FROM "${collection.name}" WHERE "id" = ? AND "deletedAt" IS NULL LIMIT 1`,
    args: [id],
  })

  if (!result.rows || result.rows.length === 0) {
    return null
  }

  return deserializeRow(result.rows[0], collection)
}

export async function update(collection: CollectionSchema, id: string, data: Record<string, any>) {
  await ensureCollectionTable(collection)
  const client = (db as any).$client

  // Check existence
  const existing = await getById(collection, id)
  if (!existing) return null

  // Build SET clause
  const setClauses: string[] = ['"updatedAt" = ?']
  const values: any[] = [Date.now()]

  for (const [fieldName, field] of Object.entries(collection.fields)) {
    if (fieldName in data) {
      setClauses.push(`"${fieldName}" = ?`)
      values.push(data[fieldName])
    }
  }

  values.push(id)

  await client.execute({
    sql: `UPDATE "${collection.name}" SET ${setClauses.join(', ')} WHERE "id" = ?`,
    args: values,
  })

  return getById(collection, id)
}

export async function remove(collection: CollectionSchema, id: string, soft = config.SOFT_DELETE) {
  await ensureCollectionTable(collection)
  const client = (db as any).$client

  // Check existence
  const existing = await getById(collection, id)
  if (!existing) return false

  if (soft) {
    await client.execute({
      sql: `UPDATE "${collection.name}" SET "deletedAt" = ?, "updatedAt" = ? WHERE "id" = ?`,
      args: [Date.now(), Date.now(), id],
    })
  } else {
    await client.execute({
      sql: `DELETE FROM "${collection.name}" WHERE "id" = ?`,
      args: [id],
    })
  }

  return true
}

function stripSystemDefaults(record: Record<string, any>, collection: CollectionSchema): Record<string, any> {
  const result: Record<string, any> = {}
  for (const key of Object.keys(record)) {
    if (key !== 'deletedAt') {
      result[key] = record[key]
    }
  }
  return result
}

function deserializeRow(row: any, collection: CollectionSchema): Record<string, any> {
  const result: Record<string, any> = {}

  for (const [key, value] of Object.entries(row)) {
    const field = collection.fields[key]

    if (field) {
      // Type-specific deserialization
      switch (field.type) {
        case 'boolean':
          result[key] = value === 1 || value === true
          break
        case 'date':
          result[key] = value ? new Date(value as number) : null
          break
        case 'json':
          result[key] = typeof value === 'string' ? JSON.parse(value) : value
          break
        case 'vector':
          result[key] = typeof value === 'string' ? JSON.parse(value) : value
          break
        default:
          result[key] = value
      }
    } else {
      // System columns
      result[key] = value
    }
  }

  return result
}
