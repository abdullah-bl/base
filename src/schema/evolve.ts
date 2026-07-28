import { createHash } from 'node:crypto'
import { ulid } from 'ulid'
import { getClient } from '../db/client.js'
import type { CollectionSchema, FieldSchema, IndexSchema } from './types.js'
import {
  buildColumnDef,
  getSqliteType,
} from '../collections/table-create.js'
import { ensureCollectionTable } from '../collections/table-create.js'

export type MigrationOp =
  | { type: 'create_table'; collection: string }
  | { type: 'add_column'; collection: string; field: string; def: string }
  | { type: 'add_index'; collection: string; index: IndexSchema }
  | {
      type: 'blocked'
      collection: string
      reason: string
    }

export interface EvolutionPlan {
  ops: MigrationOp[]
  blocked: MigrationOp[]
  fingerprints: Record<string, string>
}

export function fingerprintCollection(collection: CollectionSchema): string {
  const payload = JSON.stringify({
    name: collection.name,
    fields: collection.fields,
    indexes: collection.indexes,
  })
  return createHash('sha256').update(payload).digest('hex').slice(0, 16)
}

async function getStoredSchema(
  name: string,
): Promise<{ fingerprint: string; schemaJson: string } | null> {
  const client = getClient()
  const result = await client.execute({
    sql: `SELECT "fingerprint", "schemaJson" FROM "_base_schema" WHERE "collection" = ?`,
    args: [name],
  })
  if (!result.rows?.length) return null
  return result.rows[0] as unknown as { fingerprint: string; schemaJson: string }
}

async function tableExists(name: string): Promise<boolean> {
  const client = getClient()
  const result = await client.execute({
    sql: `SELECT name FROM sqlite_master WHERE type='table' AND name=?`,
    args: [name],
  })
  return (result.rows?.length || 0) > 0
}

async function getExistingColumns(table: string): Promise<Set<string>> {
  const client = getClient()
  const result = await client.execute(`PRAGMA table_info("${table}")`)
  const cols = new Set<string>()
  for (const row of result.rows || []) {
    cols.add(String((row as any).name))
  }
  return cols
}

/**
 * Diff registered collections against stored fingerprints / live tables.
 * Only additive ops are returned as actionable; destructive changes are blocked.
 */
export async function planEvolution(
  collections: CollectionSchema[],
): Promise<EvolutionPlan> {
  const ops: MigrationOp[] = []
  const blocked: MigrationOp[] = []
  const fingerprints: Record<string, string> = {}

  for (const collection of collections) {
    const fp = fingerprintCollection(collection)
    fingerprints[collection.name] = fp

    const exists = await tableExists(collection.name)
    if (!exists) {
      ops.push({ type: 'create_table', collection: collection.name })
      continue
    }

    const stored = await getStoredSchema(collection.name)
    const existingCols = await getExistingColumns(collection.name)

    // Detect removed columns
    if (stored) {
      const previous = JSON.parse(stored.schemaJson) as CollectionSchema
      for (const fieldName of Object.keys(previous.fields)) {
        if (!collection.fields[fieldName]) {
          blocked.push({
            type: 'blocked',
            collection: collection.name,
            reason: `Column removal is not supported: "${fieldName}". Add a manual migration or recreate the table.`,
          })
        } else {
          const prev = previous.fields[fieldName]
          const next = collection.fields[fieldName]
          if (prev.type !== next.type) {
            blocked.push({
              type: 'blocked',
              collection: collection.name,
              reason: `Type change is not supported for "${fieldName}" (${prev.type} → ${next.type}).`,
            })
          }
          if (!prev.required && next.required && next.default === undefined) {
            blocked.push({
              type: 'blocked',
              collection: collection.name,
              reason: `Making "${fieldName}" required without a default is not supported.`,
            })
          }
          if (!prev.unique && next.unique) {
            blocked.push({
              type: 'blocked',
              collection: collection.name,
              reason: `Adding UNIQUE to existing column "${fieldName}" is not auto-applied (may fail on duplicates).`,
            })
          }
        }
      }
    }

    // Additive columns
    for (const [fieldName, field] of Object.entries(collection.fields)) {
      if (!existingCols.has(fieldName)) {
        if (field.required && field.default === undefined) {
          blocked.push({
            type: 'blocked',
            collection: collection.name,
            reason: `Cannot add required column "${fieldName}" without a default.`,
          })
          continue
        }
        // SQLite ADD COLUMN cannot add NOT NULL without default in older versions —
        // we always add as nullable-or-defaulted
        const safeField: FieldSchema = {
          ...field,
          required: false, // ADD COLUMN path; enforce via app validation
        }
        ops.push({
          type: 'add_column',
          collection: collection.name,
          field: fieldName,
          def: buildColumnDef(fieldName, safeField),
        })
      }
    }

    // New indexes (best-effort from schema; IF NOT EXISTS)
    for (const index of collection.indexes) {
      ops.push({
        type: 'add_index',
        collection: collection.name,
        index,
      })
    }
  }

  return { ops, blocked, fingerprints }
}

export async function applyEvolution(
  collections: CollectionSchema[],
  options: { dryRun?: boolean } = {},
): Promise<EvolutionPlan> {
  const plan = await planEvolution(collections)

  if (plan.blocked.length > 0 && !options.dryRun) {
    const messages = plan.blocked
      .map((b) => (b.type === 'blocked' ? `  - ${b.collection}: ${b.reason}` : ''))
      .filter(Boolean)
      .join('\n')
    throw new Error(
      `Schema evolution blocked — resolve these manually before applying:\n${messages}\n\nTip: backup your database (Litestream / file copy) before schema changes.`,
    )
  }

  if (options.dryRun) {
    return plan
  }

  const client = getClient()

  for (const op of plan.ops) {
    if (op.type === 'create_table') {
      const collection = collections.find((c) => c.name === op.collection)!
      await ensureCollectionTable(collection)
      await recordMigration(op.collection, 'create_table', op.collection)
    } else if (op.type === 'add_column') {
      await client.execute(
        `ALTER TABLE "${op.collection}" ADD COLUMN ${op.def}`,
      )
      await recordMigration(
        op.collection,
        'add_column',
        `${op.field}: ${op.def}`,
      )
    } else if (op.type === 'add_index') {
      const indexName =
        op.index.name ||
        `idx_${op.collection}_${op.index.fields.join('_')}`
      const unique = op.index.unique ? 'UNIQUE' : ''
      const cols = op.index.fields.map((f) => `"${f}"`).join(', ')
      try {
        await client.execute(
          `CREATE ${unique} INDEX IF NOT EXISTS "${indexName}" ON "${op.collection}" (${cols})`,
        )
        await recordMigration(op.collection, 'add_index', indexName)
      } catch (err) {
        if (op.index.unique) throw err
        console.warn(`⚠️  Index ${indexName}:`, err)
      }
    }
  }

  // Update fingerprints
  for (const collection of collections) {
    const fp = fingerprintCollection(collection)
    const now = Date.now()
    await client.execute({
      sql: `INSERT INTO "_base_schema" ("collection", "fingerprint", "schemaJson", "updatedAt")
            VALUES (?, ?, ?, ?)
            ON CONFLICT("collection") DO UPDATE SET
              "fingerprint" = excluded."fingerprint",
              "schemaJson" = excluded."schemaJson",
              "updatedAt" = excluded."updatedAt"`,
      args: [collection.name, fp, JSON.stringify(collection), now],
    })
  }

  return plan
}

async function recordMigration(
  collection: string,
  operation: string,
  detail: string,
) {
  const client = getClient()
  await client.execute({
    sql: `INSERT INTO "_base_migrations" ("id", "collection", "operation", "detail", "appliedAt") VALUES (?, ?, ?, ?, ?)`,
    args: [ulid(), collection, operation, detail, Date.now()],
  })
}

export function formatPlan(plan: EvolutionPlan): string {
  const lines: string[] = ['Schema evolution plan:', '']
  if (plan.ops.length === 0 && plan.blocked.length === 0) {
    lines.push('  (no changes)')
  }
  for (const op of plan.ops) {
    if (op.type === 'create_table') {
      lines.push(`  + CREATE TABLE ${op.collection}`)
    } else if (op.type === 'add_column') {
      lines.push(`  + ALTER ${op.collection} ADD ${op.field}`)
    } else if (op.type === 'add_index') {
      lines.push(
        `  + INDEX ${op.collection} (${op.index.fields.join(', ')})`,
      )
    }
  }
  for (const op of plan.blocked) {
    if (op.type === 'blocked') {
      lines.push(`  ✗ BLOCKED ${op.collection}: ${op.reason}`)
    }
  }
  lines.push('')
  lines.push('Backup before applying. Litestream is recommended for production.')
  return lines.join('\n')
}

// silence unused import warning for getSqliteType if tree-shaken
void getSqliteType
