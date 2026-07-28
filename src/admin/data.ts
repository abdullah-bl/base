import { getClient } from '../db/client.js'
import { assertAllowedTable, assertIdent } from './tables.js'

export async function getTableColumns(table: string) {
  assertAllowedTable(table)
  const client = getClient()
  const info = await client.execute(`PRAGMA table_info("${table}")`)
  return (info.rows || []).map((r) => {
    const row = r as {
      name: string
      type: string
      notnull: number
      dflt_value: unknown
      pk: number
    }
    return {
      name: row.name,
      type: row.type,
      notNull: Boolean(row.notnull),
      defaultValue: row.dflt_value,
      primaryKey: Boolean(row.pk),
    }
  })
}

export async function listTableRows(
  table: string,
  opts: {
    page?: number
    perPage?: number
    sort?: string
    search?: string
    searchColumn?: string
  } = {},
) {
  assertAllowedTable(table)
  const page = Math.max(1, opts.page || 1)
  const perPage = Math.min(200, Math.max(1, opts.perPage || 50))
  const offset = (page - 1) * perPage

  const columns = await getTableColumns(table)
  const colNames = new Set(columns.map((c) => c.name))

  let orderBy = 'rowid DESC'
  if (opts.sort) {
    const desc = opts.sort.startsWith('-')
    const field = desc ? opts.sort.slice(1) : opts.sort
    assertIdent(field, 'sort field')
    if (!colNames.has(field)) {
      throw Object.assign(new Error(`Unknown sort field: ${field}`), {
        status: 400,
        code: 'VALIDATION_ERROR',
      })
    }
    orderBy = `"${field}" ${desc ? 'DESC' : 'ASC'}`
  }

  const where: string[] = ['1=1']
  const args: unknown[] = []

  if (opts.search) {
    if (opts.searchColumn) {
      assertIdent(opts.searchColumn, 'search column')
      if (!colNames.has(opts.searchColumn)) {
        throw Object.assign(new Error('Unknown search column'), {
          status: 400,
          code: 'VALIDATION_ERROR',
        })
      }
      where.push(`CAST("${opts.searchColumn}" AS TEXT) LIKE ?`)
      args.push(`%${opts.search}%`)
    } else {
      const textCols = columns.filter(
        (c) =>
          c.type.toUpperCase().includes('TEXT') ||
          c.type.toUpperCase().includes('CHAR') ||
          c.type === '',
      )
      if (textCols.length > 0) {
        where.push(
          `(${textCols.map((c) => `CAST("${c.name}" AS TEXT) LIKE ?`).join(' OR ')})`,
        )
        for (let i = 0; i < textCols.length; i++) {
          args.push(`%${opts.search}%`)
        }
      }
    }
  }

  const client = getClient()
  const whereSql = where.join(' AND ')
  const count = await client.execute({
    sql: `SELECT COUNT(*) as total FROM "${table}" WHERE ${whereSql}`,
    args: args as any[],
  })
  const total = Number(count.rows[0]?.total || 0)

  const result = await client.execute({
    sql: `SELECT * FROM "${table}" WHERE ${whereSql} ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
    args: [...args, perPage, offset] as any[],
  })

  return {
    columns,
    data: (result.rows || []) as Record<string, unknown>[],
    meta: {
      page,
      perPage,
      total,
      totalPages: Math.ceil(total / perPage) || 0,
    },
  }
}

export async function getTableRow(table: string, id: string) {
  assertAllowedTable(table)
  const columns = await getTableColumns(table)
  const pk = columns.find((c) => c.primaryKey)?.name || 'id'
  const client = getClient()
  const result = await client.execute({
    sql: `SELECT * FROM "${table}" WHERE "${pk}" = ? LIMIT 1`,
    args: [id],
  })
  return (result.rows?.[0] as Record<string, unknown>) || null
}

export async function updateTableRow(
  table: string,
  id: string,
  data: Record<string, unknown>,
) {
  assertAllowedTable(table)
  const columns = await getTableColumns(table)
  const pk = columns.find((c) => c.primaryKey)?.name || 'id'
  const colNames = new Set(columns.map((c) => c.name))

  const setClauses: string[] = []
  const args: unknown[] = []
  for (const [k, v] of Object.entries(data)) {
    if (k === pk) continue
    if (!colNames.has(k)) continue
    assertIdent(k)
    setClauses.push(`"${k}" = ?`)
    args.push(v === undefined ? null : v)
  }
  if (setClauses.length === 0) {
    return getTableRow(table, id)
  }
  args.push(id)
  const client = getClient()
  await client.execute({
    sql: `UPDATE "${table}" SET ${setClauses.join(', ')} WHERE "${pk}" = ?`,
    args: args as any[],
  })
  return getTableRow(table, id)
}

export async function deleteTableRow(table: string, id: string) {
  assertAllowedTable(table)
  const columns = await getTableColumns(table)
  const pk = columns.find((c) => c.primaryKey)?.name || 'id'
  const client = getClient()
  const result = await client.execute({
    sql: `DELETE FROM "${table}" WHERE "${pk}" = ?`,
    args: [id],
  })
  return (result.rowsAffected || 0) > 0
}

export async function executeSql(
  sql: string,
  opts: { confirmWrite?: boolean; maxRows?: number } = {},
): Promise<{
  columns: string[]
  rows: Record<string, unknown>[]
  rowsAffected?: number
  durationMs: number
  readonly: boolean
}> {
  const trimmed = sql.trim().replace(/;+\s*$/, '')
  if (!trimmed) {
    throw Object.assign(new Error('Empty SQL'), {
      status: 400,
      code: 'VALIDATION_ERROR',
    })
  }
  if (trimmed.includes(';')) {
    throw Object.assign(new Error('Multiple statements are not allowed'), {
      status: 400,
      code: 'VALIDATION_ERROR',
    })
  }

  const upper = trimmed.toUpperCase()
  const readonly =
    upper.startsWith('SELECT') ||
    upper.startsWith('EXPLAIN') ||
    upper.startsWith('WITH') ||
    upper.startsWith('PRAGMA')

  if (!readonly && !opts.confirmWrite) {
    throw Object.assign(
      new Error('Write queries require confirm: true'),
      { status: 400, code: 'CONFIRM_REQUIRED' },
    )
  }

  const client = getClient()
  const start = Date.now()
  const result = await client.execute(trimmed)
  const durationMs = Date.now() - start
  const maxRows = opts.maxRows ?? 500
  const rows = ((result.rows || []) as Record<string, unknown>[]).slice(
    0,
    maxRows,
  )
  const columns =
    rows.length > 0
      ? Object.keys(rows[0])
      : (result.columns as string[] | undefined) || []

  return {
    columns,
    rows,
    rowsAffected: result.rowsAffected,
    durationMs,
    readonly,
  }
}
