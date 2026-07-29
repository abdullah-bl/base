import { ulid } from 'ulid'
import { getClient } from '../db/client.js'
import type { CollectionSchema } from './types.js'
import { fingerprintCollection } from './evolve.js'
import { parseCollectionSchema } from './validate-schema.js'
import {
  clearRegistry,
  ensureUsersCollection,
  getRegisteredCollections,
  registerCollection,
} from './registry.js'

export interface StoredCollection {
  id: string
  name: string
  schema: CollectionSchema
  draft: CollectionSchema | null
  version: number
  fingerprint: string
  updatedAt: number
  updatedBy: string | null
}

function rowToStored(row: Record<string, unknown>): StoredCollection {
  const schema = parseCollectionSchema(JSON.parse(String(row.schemaJson)))
  let draft: CollectionSchema | null = null
  if (row.draftJson) {
    try {
      draft = parseCollectionSchema(JSON.parse(String(row.draftJson)))
    } catch {
      draft = null
    }
  }
  return {
    id: String(row.id),
    name: String(row.name),
    schema,
    draft,
    version: Number(row.version || 1),
    fingerprint: String(row.fingerprint),
    updatedAt: Number(row.updatedAt),
    updatedBy: row.updatedBy ? String(row.updatedBy) : null,
  }
}

export async function listStoredCollections(): Promise<StoredCollection[]> {
  const client = getClient()
  const result = await client.execute(
    `SELECT * FROM "_base_collections" ORDER BY "name" ASC`,
  )
  return (result.rows || []).map((r) =>
    rowToStored(r as Record<string, unknown>),
  )
}

export async function getStoredCollection(
  name: string,
): Promise<StoredCollection | null> {
  const client = getClient()
  const result = await client.execute({
    sql: `SELECT * FROM "_base_collections" WHERE "name" = ? LIMIT 1`,
    args: [name],
  })
  const row = result.rows?.[0] as Record<string, unknown> | undefined
  if (!row) return null
  return rowToStored(row)
}

export async function upsertStoredCollection(
  schemaInput: unknown,
  opts: { updatedBy?: string | null; asDraft?: boolean } = {},
): Promise<StoredCollection> {
  const schema = parseCollectionSchema(schemaInput)
  if (schema.name === 'user' || schema.name === 'users') {
    throw Object.assign(
      new Error('Cannot manage the system "user" collection'),
      { status: 400, code: 'VALIDATION_ERROR' },
    )
  }

  const client = getClient()
  const existing = await getStoredCollection(schema.name)
  const now = Date.now()
  const fp = fingerprintCollection(schema)

  if (!existing) {
    const id = ulid()
    await client.execute({
      sql: `INSERT INTO "_base_collections"
        ("id","name","schemaJson","draftJson","version","fingerprint","updatedAt","updatedBy")
        VALUES (?,?,?,NULL,1,?,?,?)`,
      args: [
        id,
        schema.name,
        JSON.stringify(schema),
        fp,
        now,
        opts.updatedBy ?? null,
      ],
    })
    return (await getStoredCollection(schema.name))!
  }

  if (opts.asDraft) {
    await client.execute({
      sql: `UPDATE "_base_collections"
            SET "draftJson"=?, "updatedAt"=?, "updatedBy"=?
            WHERE "name"=?`,
      args: [
        JSON.stringify(schema),
        now,
        opts.updatedBy ?? null,
        schema.name,
      ],
    })
  } else {
    await client.execute({
      sql: `UPDATE "_base_collections"
            SET "schemaJson"=?, "draftJson"=NULL, "version"="version"+1,
                "fingerprint"=?, "updatedAt"=?, "updatedBy"=?
            WHERE "name"=?`,
      args: [
        JSON.stringify(schema),
        fp,
        now,
        opts.updatedBy ?? null,
        schema.name,
      ],
    })
  }

  return (await getStoredCollection(schema.name))!
}

export async function deleteStoredCollection(name: string): Promise<boolean> {
  const client = getClient()
  const result = await client.execute({
    sql: `DELETE FROM "_base_collections" WHERE "name" = ?`,
    args: [name],
  })
  return (result.rowsAffected || 0) > 0
}

export async function publishDraft(
  name: string,
  updatedBy?: string | null,
): Promise<StoredCollection> {
  const existing = await getStoredCollection(name)
  if (!existing?.draft) {
    throw Object.assign(new Error('No draft to publish'), {
      status: 400,
      code: 'VALIDATION_ERROR',
    })
  }
  return upsertStoredCollection(existing.draft, { updatedBy, asDraft: false })
}

/**
 * Load DB collections into the in-memory registry (clears user collections first).
 */
export async function loadRegistryFromDb(): Promise<CollectionSchema[]> {
  clearRegistry()
  ensureUsersCollection()
  const stored = await listStoredCollections()
  for (const item of stored) {
    registerCollection(item.schema)
  }
  return getRegisteredCollections().filter(
    (c) => c.name !== 'user' && c.name !== 'users',
  )
}

/**
 * One-time import: if registry has collections and DB store is empty, persist them.
 */
export async function importRegistryToDbIfEmpty(
  updatedBy = 'migration',
): Promise<number> {
  const existing = await listStoredCollections()
  if (existing.length > 0) return 0

  const collections = getRegisteredCollections().filter(
    (c) => c.name !== 'user' && c.name !== 'users',
  )
  let n = 0
  for (const col of collections) {
    await upsertStoredCollection(col, { updatedBy })
    n++
  }
  return n
}

/**
 * Export all active schemas as a portable JSON document.
 */
export async function exportSchemasJson(): Promise<{
  version: 1
  exportedAt: number
  collections: CollectionSchema[]
}> {
  const stored = await listStoredCollections()
  return {
    version: 1,
    exportedAt: Date.now(),
    collections: stored.map((s) => s.schema),
  }
}

export async function importSchemasJson(
  doc: unknown,
  opts: { updatedBy?: string | null; replace?: boolean } = {},
): Promise<{ imported: string[] }> {
  const parsed = doc as {
    version?: number
    collections?: unknown[]
  }
  if (!parsed || !Array.isArray(parsed.collections)) {
    throw Object.assign(new Error('Invalid schema export document'), {
      status: 400,
      code: 'VALIDATION_ERROR',
    })
  }

  if (opts.replace) {
    const existing = await listStoredCollections()
    for (const e of existing) {
      await deleteStoredCollection(e.name)
    }
  }

  const imported: string[] = []
  for (const raw of parsed.collections) {
    const stored = await upsertStoredCollection(raw, {
      updatedBy: opts.updatedBy,
    })
    imported.push(stored.name)
  }
  await loadRegistryFromDb()
  return { imported }
}

/** Generate TypeScript collections.ts source from stored schemas (export only). */
export function schemasToTypescript(collections: CollectionSchema[]): string {
  const lines: string[] = [
    '/**',
    ' * Generated by Base Admin — schema source of truth is the database.',
    ' * This file is an optional export for version control / typed tooling.',
    ' */',
    '',
    "import { defineCollection, f } from '@base/core/schema'",
    '',
  ]

  for (const col of collections) {
    lines.push(`export const ${col.name} = defineCollection('${col.name}', {`)
    lines.push('  fields: {')
    for (const [name, field] of Object.entries(col.fields)) {
      let expr = ''
      switch (field.type) {
        case 'reference':
          expr = `f.reference('${field.ref}')`
          break
        case 'vector':
          expr = `f.vector(${field.vectorSize || 0})`
          break
        default:
          expr = `f.${field.type}()`
      }
      if (field.required) expr += '.required()'
      else expr += '.optional()'
      if (field.unique) expr += '.unique()'
      if (field.max != null) expr += `.max(${field.max})`
      if (field.min != null) expr += `.min(${field.min})`
      if (field.default !== undefined)
        expr += `.default(${JSON.stringify(field.default)})`
      lines.push(`    ${name}: ${expr},`)
    }
    lines.push('  },')
    if (col.indexes?.length) {
      lines.push(`  indexes: ${JSON.stringify(col.indexes, null, 2).replace(/\n/g, '\n  ')},`)
    }
    if (col.access) {
      lines.push(`  access: ${JSON.stringify(col.access, null, 2).replace(/\n/g, '\n  ')},`)
    }
    lines.push('})')
    lines.push('')
  }

  return lines.join('\n')
}
