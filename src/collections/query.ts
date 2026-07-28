import type { CollectionSchema } from '../schema/types.js'
import { getClient } from '../db/client.js'
import { ensureCollectionTable } from './table-create.js'
import { deserializeRow, SerializationError } from './serialize.js'
import {
  assertAccess,
  ownerFilterSql,
  type AuthUser,
} from './access.js'

export interface ListParams {
  filter?: Record<string, string>
  sort?: string
  page?: number
  perPage?: number
}

export interface ListResult<T = unknown> {
  data: T[]
  meta: {
    page: number
    perPage: number
    total: number
    totalPages: number
  }
}

const MAX_PER_PAGE = 100
const DEFAULT_PER_PAGE = 20

export async function list(
  collection: CollectionSchema,
  params: ListParams = {},
  user?: AuthUser | null,
): Promise<ListResult> {
  await ensureCollectionTable(collection)

  if (user !== undefined) {
    assertAccess(collection, 'read', { user })
  }

  const page = Math.max(1, params.page || 1)
  const perPage = Math.min(
    MAX_PER_PAGE,
    Math.max(1, params.perPage || DEFAULT_PER_PAGE),
  )
  const offset = (page - 1) * perPage

  const whereClauses: string[] = ['"deletedAt" IS NULL']
  const args: unknown[] = []

  const owner = user !== undefined ? ownerFilterSql(collection, 'read', user) : null
  if (owner) {
    whereClauses.push(owner.sql)
    args.push(...owner.args)
  }

  if (params.filter) {
    for (const [field, value] of Object.entries(params.filter)) {
      if (!(collection.fields[field] || isSystemField(field))) {
        const err = new Error(
          `Unknown filter field: ${field}`,
        ) as Error & { status?: number; code?: string }
        err.status = 400
        err.code = 'VALIDATION_ERROR'
        throw err
      }
      whereClauses.push(`"${field}" = ?`)
      args.push(value)
    }
  }

  let orderBy = '"createdAt" DESC'
  if (params.sort) {
    const sortParts = params.sort
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    const orderParts: string[] = []

    for (const part of sortParts) {
      const desc = part.startsWith('-')
      const fieldName = desc ? part.slice(1) : part

      if (!(collection.fields[fieldName] || isSystemField(fieldName))) {
        const err = new Error(
          `Unknown sort field: ${fieldName}`,
        ) as Error & { status?: number; code?: string }
        err.status = 400
        err.code = 'VALIDATION_ERROR'
        throw err
      }
      orderParts.push(`"${fieldName}" ${desc ? 'DESC' : 'ASC'}`)
    }

    if (orderParts.length > 0) {
      orderBy = orderParts.join(', ')
    }
  }

  const whereSQL = whereClauses.join(' AND ')
  const client = getClient()

  const countResult = await client.execute({
    sql: `SELECT COUNT(*) as total FROM "${collection.name}" WHERE ${whereSQL}`,
    args: args as any[],
  })
  const total = Number(countResult.rows[0]?.total || 0)

  const result = await client.execute({
    sql: `SELECT * FROM "${collection.name}" WHERE ${whereSQL} ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
    args: [...args, perPage, offset] as any[],
  })

  let data: Record<string, unknown>[]
  try {
    data = (result.rows || []).map((row) =>
      deserializeRow(row as Record<string, unknown>, collection),
    )
  } catch (err) {
    if (err instanceof SerializationError) {
      const e = err as SerializationError & { status?: number; code?: string }
      e.status = 500
      e.code = 'DATA_ERROR'
    }
    throw err
  }

  return {
    data,
    meta: {
      page,
      perPage,
      total,
      totalPages: Math.ceil(total / perPage) || 0,
    },
  }
}

function isSystemField(field: string): boolean {
  return ['id', 'createdAt', 'updatedAt', 'deletedAt'].includes(field)
}
