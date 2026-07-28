import { createClient } from '@libsql/client'
import env from '../env.js'
import type { CollectionSchema } from '../schema/types.js'
import { ensureCollectionTable } from './table-create.js'

const client = createClient({
  url: env.DATABASE_URL,
  authToken: env.DATABASE_AUTH_TOKEN,
})

export interface ListParams {
  filter?: Record<string, string>
  sort?: string
  page?: number
  perPage?: number
}

export interface ListResult<T = any> {
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

export async function list(collection: CollectionSchema, params: ListParams = {}): Promise<ListResult> {
  await ensureCollectionTable(collection)

  const page = Math.max(1, params.page || 1)
  const perPage = Math.min(MAX_PER_PAGE, Math.max(1, params.perPage || DEFAULT_PER_PAGE))
  const offset = (page - 1) * perPage

  // Build WHERE clause
  const whereClauses: string[] = ['"deletedAt" IS NULL']
  const args: any[] = []

  if (params.filter) {
    for (const [field, value] of Object.entries(params.filter)) {
      if (collection.fields[field] || isSystemField(field)) {
        whereClauses.push(`"${field}" = ?`)
        args.push(value)
      }
    }
  }

  // Build ORDER BY
  let orderBy = '"createdAt" DESC'
  if (params.sort) {
    const sortParts = params.sort.split(',').map(s => s.trim()).filter(Boolean)
    const orderParts: string[] = []

    for (const part of sortParts) {
      const desc = part.startsWith('-')
      const fieldName = desc ? part.slice(1) : part

      if (collection.fields[fieldName] || isSystemField(fieldName)) {
        orderParts.push(`"${fieldName}" ${desc ? 'DESC' : 'ASC'}`)
      }
    }

    if (orderParts.length > 0) {
      orderBy = orderParts.join(', ')
    }
  }

  const whereSQL = whereClauses.join(' AND ')

  // Count total
  const countResult = await client.execute({
    sql: `SELECT COUNT(*) as total FROM "${collection.name}" WHERE ${whereSQL}`,
    args,
  })
  const total = Number(countResult.rows[0]?.total || 0)

  // Fetch page
  const result = await client.execute({
    sql: `SELECT * FROM "${collection.name}" WHERE ${whereSQL} ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
    args: [...args, perPage, offset],
  })

  const data = (result.rows || []).map((row: any) => deserializeRow(row, collection))

  return {
    data,
    meta: {
      page,
      perPage,
      total,
      totalPages: Math.ceil(total / perPage),
    },
  }
}

function isSystemField(field: string): boolean {
  return ['id', 'createdAt', 'updatedAt', 'deletedAt'].includes(field)
}

function deserializeRow(row: any, collection: CollectionSchema): Record<string, any> {
  const result: Record<string, any> = {}

  for (const [key, value] of Object.entries(row)) {
    const field = collection.fields[key]

    if (field) {
      switch (field.type) {
        case 'boolean':
          result[key] = value === 1 || value === true
          break
        case 'date':
          result[key] = value ? new Date(value as number) : null
          break
        case 'json':
        case 'vector':
          result[key] = typeof value === 'string' ? JSON.parse(value) : value
          break
        default:
          result[key] = value
      }
    } else {
      result[key] = value
    }
  }

  return result
}
