import { getClient } from '../db/client.js'
import { getCollection } from '../schema/registry.js'
import type { CollectionSchema } from '../schema/types.js'
import { canReadRecord, type AuthUser } from './access.js'
import { deserializeRow } from './serialize.js'

const MAX_JOIN_DEPTH = 2
const MAX_REVERSE_ROWS = 50

/**
 * Join related records directly into each row's `data` object.
 *
 * This is Base's relation API — not PocketBase-style `expand` sidecars.
 *
 * Syntax:
 *   ?join=authorId,comments
 *   ?join=author,comments          (authorId → relation key "author")
 *   ?join=author:authorId          (alias:field)
 *   ?join=comments.authorId        (nested)
 *
 * Result shape (forward):
 *   { id, title, authorId, author: { id, name, ... } }
 *
 * Result shape (reverse collection):
 *   { id, title, comments: [ { id, body, ... } ] }
 *
 * FK scalar fields (authorId) are always preserved.
 * Access rules run through the same canReadRecord layer as CRUD/SSE.
 */
export async function joinRecords(
  collection: CollectionSchema,
  records: Record<string, unknown>[],
  joinParam: string,
  user: AuthUser | null,
  depth = 0,
): Promise<Record<string, unknown>[]> {
  if (!joinParam || depth >= MAX_JOIN_DEPTH || records.length === 0) {
    return records
  }

  const specs = parseJoinParam(joinParam)
  if (specs.length === 0) return records

  const out: Record<string, unknown>[] = records.map((r) => ({ ...r }))
  const client = getClient()

  for (const spec of specs) {
    const resolved = resolveJoinTarget(collection, spec.head)
    if (!resolved) continue

    if (resolved.kind === 'forward') {
      const { fieldName, relationKey, targetName } = resolved
      const ids = [
        ...new Set(
          out
            .map((r) => r[fieldName])
            .filter((v) => v != null && v !== '')
            .map(String),
        ),
      ]

      const byId = new Map<string, Record<string, unknown>>()
      if (ids.length > 0) {
        const placeholders = ids.map(() => '?').join(', ')
        try {
          const result = await client.execute({
            sql: `SELECT * FROM "${targetName}" WHERE "id" IN (${placeholders})`,
            args: ids,
          })
          const targetSchema = targetSchemaFor(targetName)
          const rows = (result.rows || []).map((row) =>
            deserializeRow(
              row as Record<string, unknown>,
              targetSchema ||
                ({ name: targetName, fields: {}, indexes: [] } as CollectionSchema),
            ),
          )
          for (const row of rows) {
            if (targetSchema && !canReadRecord(targetSchema, user, row)) continue
            byId.set(String(row.id), row)
          }

          if (spec.nested && targetSchema) {
            let nestedRows = [...byId.values()]
            nestedRows = await joinRecords(
              targetSchema,
              nestedRows,
              spec.nested,
              user,
              depth + 1,
            )
            for (const row of nestedRows) {
              byId.set(String(row.id), row)
            }
          }
        } catch {
          // Unknown / missing target table — leave relation null
        }
      }

      for (const rec of out) {
        const id = rec[fieldName] != null ? String(rec[fieldName]) : null
        rec[relationKey] = id ? byId.get(id) || null : null
      }
      continue
    }

    // Reverse: join child collection rows into data.<collectionName>
    const related = resolved.collection
    const refName = resolved.refField
    const relationKey = spec.alias || related.name
    const parentIds = out.map((r) => String(r.id))
    const placeholders = parentIds.map(() => '?').join(', ')
    const byParent = new Map<string, Record<string, unknown>[]>()

    try {
      const result = await client.execute({
        sql: `SELECT * FROM "${related.name}"
              WHERE "${refName}" IN (${placeholders})
                AND "deletedAt" IS NULL
              ORDER BY "createdAt" DESC
              LIMIT ?`,
        args: [...parentIds, MAX_REVERSE_ROWS * Math.max(parentIds.length, 1)],
      })
      let children = (result.rows || []).map((row) =>
        deserializeRow(row as Record<string, unknown>, related),
      )
      children = children.filter((row) => canReadRecord(related, user, row))
      if (spec.nested) {
        children = await joinRecords(
          related,
          children,
          spec.nested,
          user,
          depth + 1,
        )
      }
      for (const child of children) {
        const pid = String(child[refName])
        const list = byParent.get(pid) || []
        if (list.length < MAX_REVERSE_ROWS) list.push(child)
        byParent.set(pid, list)
      }
    } catch {
      // ignore
    }

    for (const rec of out) {
      rec[relationKey] = byParent.get(String(rec.id)) || []
    }
  }

  return out
}

interface JoinSpec {
  /** First path segment (field, alias:field, or collection) */
  head: string
  alias?: string
  nested: string
}

function parseJoinParam(joinParam: string): JoinSpec[] {
  return joinParam
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((raw) => {
      const [headPath, ...rest] = raw.split('.')
      const nested = rest.join('.')
      const aliasMatch = headPath.match(/^([a-zA-Z_][a-zA-Z0-9_]*):([a-zA-Z_][a-zA-Z0-9_]*)$/)
      if (aliasMatch) {
        return { head: aliasMatch[2], alias: aliasMatch[1], nested }
      }
      return { head: headPath, nested }
    })
}

type ResolvedJoin =
  | {
      kind: 'forward'
      fieldName: string
      relationKey: string
      targetName: string
    }
  | {
      kind: 'reverse'
      collection: CollectionSchema
      refField: string
    }

/**
 * Resolve a join segment against the parent collection.
 * Accepts FK field (`authorId`), relation key (`author`), or reverse collection (`comments`).
 */
function resolveJoinTarget(
  collection: CollectionSchema,
  head: string,
): ResolvedJoin | null {
  // Explicit FK field
  const direct = collection.fields[head]
  if (direct?.type === 'reference' && direct.ref) {
    return {
      kind: 'forward',
      fieldName: head,
      relationKey: relationKeyFromField(head),
      targetName: direct.ref,
    }
  }

  // Relation key without Id suffix → find matching *Id / *_id reference field
  for (const [fieldName, field] of Object.entries(collection.fields)) {
    if (field.type !== 'reference' || !field.ref) continue
    if (relationKeyFromField(fieldName) === head) {
      return {
        kind: 'forward',
        fieldName,
        relationKey: head,
        targetName: field.ref,
      }
    }
  }

  // Reverse collection join
  const related = getCollection(head)
  if (related) {
    const refField = Object.entries(related.fields).find(
      ([, f]) => f.type === 'reference' && f.ref === collection.name,
    )
    if (refField) {
      return {
        kind: 'reverse',
        collection: related,
        refField: refField[0],
      }
    }
  }

  return null
}

/** authorId → author, user_id → user, author → author */
export function relationKeyFromField(fieldName: string): string {
  if (fieldName.endsWith('Id') && fieldName.length > 2) {
    return fieldName.slice(0, -2)
  }
  if (fieldName.endsWith('_id') && fieldName.length > 3) {
    return fieldName.slice(0, -3)
  }
  return fieldName
}

function targetSchemaFor(targetName: string): CollectionSchema | null {
  const existing = getCollection(targetName)
  if (existing) return existing
  if (targetName === 'user' || targetName === 'users') {
    return {
      name: 'user',
      fields: {
        email: {
          type: 'string',
          required: false,
          optional: true,
          unique: true,
        },
        name: {
          type: 'string',
          required: false,
          optional: true,
          unique: false,
        },
        image: {
          type: 'string',
          required: false,
          optional: true,
          unique: false,
        },
      },
      indexes: [],
      access: { read: 'authenticated' },
    }
  }
  return null
}
