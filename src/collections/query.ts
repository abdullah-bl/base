import type { CollectionSchema } from '../schema/types.js'
import { getClient } from '../db/client.js'
import { ensureCollectionTable } from './table-create.js'
import { deserializeRow, SerializationError } from './serialize.js'
import {
  assertAccess,
  ownerFilterSql,
  type AuthUser,
} from './access.js'

export type FilterValue =
  | string
  | number
  | boolean
  | null
  | { op: FilterOp; value?: unknown }

export type FilterOp =
  | 'eq'
  | 'ne'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'like'
  | 'in'
  | 'null'
  | 'nnull'

export interface ListParams {
  filter?: Record<string, FilterValue>
  sort?: string
  page?: number
  perPage?: number
  /** Full-text search query (FTS5 when available, else LIKE fallback) */
  search?: string
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

const OPS = new Set<FilterOp>([
  'eq',
  'ne',
  'gt',
  'gte',
  'lt',
  'lte',
  'like',
  'in',
  'null',
  'nnull',
])

export function buildFilterClause(
  collection: CollectionSchema,
  filter: Record<string, FilterValue> | undefined,
): { sql: string[]; args: unknown[] } {
  const whereClauses: string[] = []
  const args: unknown[] = []

  if (!filter) return { sql: whereClauses, args }

  for (const [rawField, rawValue] of Object.entries(filter)) {
    let field = rawField
    let op: FilterOp = 'eq'
    let value: unknown = rawValue

    // Support field__op syntax: title__like, viewCount__gte
    const opMatch = rawField.match(/^(.+)__(eq|ne|gt|gte|lt|lte|like|in|null|nnull)$/)
    if (opMatch) {
      field = opMatch[1]
      op = opMatch[2] as FilterOp
    } else if (
      rawValue &&
      typeof rawValue === 'object' &&
      !Array.isArray(rawValue) &&
      'op' in (rawValue as object)
    ) {
      const obj = rawValue as { op: FilterOp; value?: unknown }
      if (!OPS.has(obj.op)) {
        const err = new Error(`Unknown filter operator: ${obj.op}`) as Error & {
          status?: number
          code?: string
        }
        err.status = 400
        err.code = 'VALIDATION_ERROR'
        throw err
      }
      op = obj.op
      value = obj.value
    }

    if (!(collection.fields[field] || isSystemField(field))) {
      const err = new Error(`Unknown filter field: ${field}`) as Error & {
        status?: number
        code?: string
      }
      err.status = 400
      err.code = 'VALIDATION_ERROR'
      throw err
    }

    switch (op) {
      case 'eq':
        whereClauses.push(`"${field}" = ?`)
        args.push(coerceValue(value))
        break
      case 'ne':
        whereClauses.push(`"${field}" != ?`)
        args.push(coerceValue(value))
        break
      case 'gt':
        whereClauses.push(`"${field}" > ?`)
        args.push(coerceValue(value))
        break
      case 'gte':
        whereClauses.push(`"${field}" >= ?`)
        args.push(coerceValue(value))
        break
      case 'lt':
        whereClauses.push(`"${field}" < ?`)
        args.push(coerceValue(value))
        break
      case 'lte':
        whereClauses.push(`"${field}" <= ?`)
        args.push(coerceValue(value))
        break
      case 'like':
        whereClauses.push(`"${field}" LIKE ?`)
        args.push(String(value))
        break
      case 'in': {
        const list = Array.isArray(value)
          ? value
          : String(value)
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean)
        if (list.length === 0) {
          whereClauses.push('1=0')
          break
        }
        whereClauses.push(
          `"${field}" IN (${list.map(() => '?').join(', ')})`,
        )
        args.push(...list.map(coerceValue))
        break
      }
      case 'null':
        whereClauses.push(`"${field}" IS NULL`)
        break
      case 'nnull':
        whereClauses.push(`"${field}" IS NOT NULL`)
        break
    }
  }

  return { sql: whereClauses, args }
}

function coerceValue(value: unknown): unknown {
  if (value === 'true') return 1
  if (value === 'false') return 0
  if (value === 'null') return null
  return value
}

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

  const filter = buildFilterClause(collection, params.filter)
  whereClauses.push(...filter.sql)
  args.push(...filter.args)

  if (params.search) {
    const textFields = Object.entries(collection.fields)
      .filter(([, f]) => f.type === 'string' || f.type === 'text')
      .map(([name]) => name)
    if (textFields.length > 0) {
      const like = `%${params.search}%`
      whereClauses.push(
        `(${textFields.map((f) => `"${f}" LIKE ?`).join(' OR ')})`,
      )
      for (let i = 0; i < textFields.length; i++) args.push(like)
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
