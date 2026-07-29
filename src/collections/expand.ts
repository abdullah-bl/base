import { getClient } from '../db/client.js'
import { getCollection } from '../schema/registry.js'
import type { CollectionSchema } from '../schema/types.js'
import { canReadRecord, type AuthUser } from './access.js'
import { deserializeRow } from './serialize.js'

const MAX_EXPAND_DEPTH = 2
const MAX_REVERSE_ROWS = 50

/**
 * Expand reference fields and reverse relations.
 *
 * Syntax: ?expand=authorId,comments
 * - Forward: field type reference → embed target record as `expand.fieldName`
 * - Reverse: otherCollection name → embed array of records where ref points here
 */
export async function expandRecords(
  collection: CollectionSchema,
  records: Record<string, unknown>[],
  expandParam: string,
  user: AuthUser | null,
  depth = 0,
): Promise<Record<string, unknown>[]> {
  if (!expandParam || depth >= MAX_EXPAND_DEPTH || records.length === 0) {
    return records
  }

  const keys = expandParam
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  if (keys.length === 0) return records

  const client = getClient()
  const out: Record<string, unknown>[] = records.map((r) => ({
    ...r,
    expand: { ...((r.expand as object) || {}) },
  }))

  for (const key of keys) {
    // Nested expand: authorId.profile — first segment only at this depth
    const [head, ...rest] = key.split('.')
    const nested = rest.join('.')

    const field = collection.fields[head]
    if (field?.type === 'reference' && field.ref) {
      const targetName = field.ref
      const ids = [
        ...new Set(
          out
            .map((r) => r[head])
            .filter((v) => v != null && v !== '')
            .map(String),
        ),
      ]
      if (ids.length === 0) continue

      const placeholders = ids.map(() => '?').join(', ')
      let rows: Record<string, unknown>[] = []
      try {
        const result = await client.execute({
          sql: `SELECT * FROM "${targetName}" WHERE "id" IN (${placeholders})`,
          args: ids,
        })
        const schemaForSer =
          getCollection(targetName) ||
          ({ name: targetName, fields: {}, indexes: [] } as CollectionSchema)
        rows = (result.rows || []).map((row) =>
          deserializeRow(row as Record<string, unknown>, schemaForSer),
        )
      } catch {
        continue
      }

      const targetSchema =
        getCollection(targetName) ||
        (targetName === 'user'
          ? ({
              name: 'user',
              fields: {},
              indexes: [],
              access: { read: 'authenticated' },
            } as CollectionSchema)
          : null)

      const byId = new Map<string, Record<string, unknown>>()
      for (const row of rows) {
        if (targetSchema && !canReadRecord(targetSchema, user, row)) continue
        byId.set(String(row.id), row)
      }

      let expandedList = [...byId.values()]
      if (nested && targetSchema) {
        expandedList = await expandRecords(
          targetSchema,
          expandedList,
          nested,
          user,
          depth + 1,
        )
        for (const row of expandedList) {
          byId.set(String(row.id), row)
        }
      }

      for (const rec of out) {
        const id = rec[head] != null ? String(rec[head]) : null
        ;(rec.expand as Record<string, unknown>)[head] = id
          ? byId.get(id) || null
          : null
      }
      continue
    }

    // Reverse relation: expand by collection name whose reference points here
    const related = getCollection(head)
    if (related) {
      const refField = Object.entries(related.fields).find(
        ([, f]) => f.type === 'reference' && f.ref === collection.name,
      )
      if (!refField) continue
      const [refName] = refField
      const parentIds = out.map((r) => String(r.id))
      const placeholders = parentIds.map(() => '?').join(', ')
      try {
        const result = await client.execute({
          sql: `SELECT * FROM "${related.name}"
                WHERE "${refName}" IN (${placeholders})
                  AND "deletedAt" IS NULL
                ORDER BY "createdAt" DESC
                LIMIT ?`,
          args: [...parentIds, MAX_REVERSE_ROWS * parentIds.length],
        })
        let children = (result.rows || []).map((row) =>
          deserializeRow(row as Record<string, unknown>, related),
        )
        children = children.filter((row) => canReadRecord(related, user, row))
        if (nested) {
          children = await expandRecords(
            related,
            children,
            nested,
            user,
            depth + 1,
          )
        }
        const byParent = new Map<string, Record<string, unknown>[]>()
        for (const child of children) {
          const pid = String(child[refName])
          const list = byParent.get(pid) || []
          if (list.length < MAX_REVERSE_ROWS) list.push(child)
          byParent.set(pid, list)
        }
        for (const rec of out) {
          ;(rec.expand as Record<string, unknown>)[head] =
            byParent.get(String(rec.id)) || []
        }
      } catch {
        for (const rec of out) {
          ;(rec.expand as Record<string, unknown>)[head] = []
        }
      }
    }
  }

  return out
}
