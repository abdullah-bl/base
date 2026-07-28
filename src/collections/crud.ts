import { ulid } from 'ulid'
import type { CollectionSchema } from '../schema/types.js'
import { config } from '../config.js'
import { getClient } from '../db/client.js'
import { ensureCollectionTable } from './table-create.js'
import {
  deserializeRow,
  serializeFieldValue,
  SerializationError,
} from './serialize.js'
import {
  applyOwnerOnCreate,
  assertAccess,
  ownerFilterSql,
  type AuthUser,
} from './access.js'

export async function create(
  collection: CollectionSchema,
  data: Record<string, unknown>,
  user?: AuthUser | null,
) {
  await ensureCollectionTable(collection)

  if (user) {
    assertAccess(collection, 'create', { user })
    data = applyOwnerOnCreate(collection, data, user)
  }

  const now = Date.now()
  const record: Record<string, unknown> = {
    id: ulid(),
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  }

  for (const [fieldName, field] of Object.entries(collection.fields)) {
    if (fieldName in data) {
      record[fieldName] = serializeFieldValue(
        field,
        data[fieldName],
        fieldName,
      )
    } else if (field.default !== undefined) {
      record[fieldName] = serializeFieldValue(
        field,
        field.default,
        fieldName,
      )
    } else if (field.required) {
      const err = new Error(`Missing required field: ${fieldName}`) as Error & {
        status?: number
        code?: string
      }
      err.status = 400
      err.code = 'VALIDATION_ERROR'
      throw err
    }
  }

  const columns = Object.keys(record)
    .map((c) => `"${c}"`)
    .join(', ')
  const placeholders = Object.keys(record)
    .map(() => '?')
    .join(', ')
  const values = Object.values(record)

  const client = getClient()
  await client.execute({
    sql: `INSERT INTO "${collection.name}" (${columns}) VALUES (${placeholders})`,
    args: values as any[],
  })

  return deserializeRow(record as Record<string, unknown>, collection)
}

export async function getById(
  collection: CollectionSchema,
  id: string,
  user?: AuthUser | null,
) {
  await ensureCollectionTable(collection)
  const client = getClient()

  const where: string[] = ['"id" = ?', '"deletedAt" IS NULL']
  const args: unknown[] = [id]

  if (user !== undefined) {
    const owner = ownerFilterSql(collection, 'read', user)
    if (owner) {
      where.push(owner.sql)
      args.push(...owner.args)
    } else {
      assertAccess(collection, 'read', { user })
    }
  }

  const result = await client.execute({
    sql: `SELECT * FROM "${collection.name}" WHERE ${where.join(' AND ')} LIMIT 1`,
    args: args as any[],
  })

  if (!result.rows || result.rows.length === 0) {
    return null
  }

  try {
    const row = deserializeRow(
      result.rows[0] as Record<string, unknown>,
      collection,
    )
    if (user !== undefined) {
      assertAccess(collection, 'read', { user }, row)
    }
    return row
  } catch (err) {
    if (err instanceof SerializationError) {
      const e = err as SerializationError & { status?: number; code?: string }
      e.status = 500
      e.code = 'DATA_ERROR'
    }
    throw err
  }
}

export async function update(
  collection: CollectionSchema,
  id: string,
  data: Record<string, unknown>,
  user?: AuthUser | null,
) {
  await ensureCollectionTable(collection)
  const client = getClient()

  const existing = await getByIdInternal(collection, id)
  if (!existing) return null

  if (user !== undefined) {
    assertAccess(collection, 'update', { user }, existing)
    // Prevent spoofing ownership
    const ownerField = collection.access?.ownerField
    if (ownerField && ownerField in data) {
      delete data[ownerField]
    }
  }

  const setClauses: string[] = ['"updatedAt" = ?']
  const values: unknown[] = [Date.now()]

  for (const [fieldName, field] of Object.entries(collection.fields)) {
    if (fieldName in data) {
      setClauses.push(`"${fieldName}" = ?`)
      values.push(serializeFieldValue(field, data[fieldName], fieldName))
    }
  }

  values.push(id)

  const result = await client.execute({
    sql: `UPDATE "${collection.name}" SET ${setClauses.join(', ')} WHERE "id" = ? AND "deletedAt" IS NULL`,
    args: values as any[],
  })

  if ((result.rowsAffected || 0) === 0) return null

  return getByIdInternal(collection, id)
}

export async function remove(
  collection: CollectionSchema,
  id: string,
  soft = config.SOFT_DELETE,
  user?: AuthUser | null,
) {
  await ensureCollectionTable(collection)
  const client = getClient()

  const existing = await getByIdInternal(collection, id)
  if (!existing) return false

  if (user !== undefined) {
    assertAccess(collection, 'delete', { user }, existing)
  }

  if (!soft && !config.HARD_DELETE_ENABLED) {
    const err = new Error(
      'Hard delete is disabled. Set HARD_DELETE_ENABLED=true to allow permanent deletion.',
    ) as Error & { status?: number; code?: string }
    err.status = 403
    err.code = 'HARD_DELETE_DISABLED'
    throw err
  }

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

async function getByIdInternal(
  collection: CollectionSchema,
  id: string,
): Promise<Record<string, unknown> | null> {
  await ensureCollectionTable(collection)
  const client = getClient()
  const result = await client.execute({
    sql: `SELECT * FROM "${collection.name}" WHERE "id" = ? AND "deletedAt" IS NULL LIMIT 1`,
    args: [id],
  })
  if (!result.rows || result.rows.length === 0) return null
  return deserializeRow(
    result.rows[0] as Record<string, unknown>,
    collection,
  )
}
