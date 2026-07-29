import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { ulid } from 'ulid'
import { getClient } from '../db/client.js'

export interface ApiKeyRecord {
  id: string
  name: string
  keyPrefix: string
  scopes: string[]
  expiresAt: number | null
  lastUsedAt: number | null
  createdBy: string | null
  createdAt: number
  revokedAt: number | null
}

function hashKey(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}

export async function createApiKey(opts: {
  name: string
  scopes?: string[]
  expiresAt?: number | null
  createdBy?: string | null
}): Promise<{ record: ApiKeyRecord; key: string }> {
  const id = ulid()
  const raw = `base_${randomBytes(24).toString('base64url')}`
  const keyHash = hashKey(raw)
  const keyPrefix = raw.slice(0, 12)
  const createdAt = Date.now()
  const scopes = opts.scopes ?? ['collections:*']

  const client = getClient()
  await client.execute({
    sql: `INSERT INTO "_base_api_keys" (
      "id", "name", "keyHash", "keyPrefix", "scopes", "expiresAt", "lastUsedAt",
      "createdBy", "createdAt", "revokedAt"
    ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, NULL)`,
    args: [
      id,
      opts.name,
      keyHash,
      keyPrefix,
      JSON.stringify(scopes),
      opts.expiresAt ?? null,
      opts.createdBy ?? null,
      createdAt,
    ],
  })

  return {
    key: raw,
    record: {
      id,
      name: opts.name,
      keyPrefix,
      scopes,
      expiresAt: opts.expiresAt ?? null,
      lastUsedAt: null,
      createdBy: opts.createdBy ?? null,
      createdAt,
      revokedAt: null,
    },
  }
}

export async function listApiKeys(): Promise<ApiKeyRecord[]> {
  const client = getClient()
  const result = await client.execute(
    `SELECT * FROM "_base_api_keys" ORDER BY "createdAt" DESC`,
  )
  return (result.rows || []).map(rowToRecord)
}

export async function revokeApiKey(id: string): Promise<boolean> {
  const client = getClient()
  const result = await client.execute({
    sql: `UPDATE "_base_api_keys" SET "revokedAt" = ? WHERE "id" = ? AND "revokedAt" IS NULL`,
    args: [Date.now(), id],
  })
  return (result.rowsAffected || 0) > 0
}

export async function deleteApiKey(id: string): Promise<boolean> {
  const client = getClient()
  const result = await client.execute({
    sql: `DELETE FROM "_base_api_keys" WHERE "id" = ?`,
    args: [id],
  })
  return (result.rowsAffected || 0) > 0
}

export function apiKeyHasScope(scopes: string[], needed: string): boolean {
  if (scopes.includes('*') || scopes.includes('admin')) return true
  if (scopes.includes(needed)) return true
  // Wildcard prefix: collections:* matches collections:posts
  const [neededNs] = needed.split(':')
  if (scopes.includes(`${neededNs}:*`)) return true
  return false
}

/**
 * Validate a Bearer API key. Returns a synthetic user-like object on success.
 * Admin role is granted only when scopes include `admin` or `*`.
 */
export async function verifyApiKey(
  raw: string,
): Promise<{
  id: string
  name: string
  role: 'admin' | 'user'
  scopes: string[]
} | null> {
  if (!raw.startsWith('base_')) return null
  const keyHash = hashKey(raw)
  const client = getClient()
  const result = await client.execute({
    sql: `SELECT * FROM "_base_api_keys" WHERE "keyHash" = ? LIMIT 1`,
    args: [keyHash],
  })
  const row = result.rows?.[0] as Record<string, unknown> | undefined
  if (!row) {
    // Timing-safe miss: still compare against dummy
    safeEqual(keyHash, keyHash)
    return null
  }
  if (row.revokedAt) return null
  if (row.expiresAt && Number(row.expiresAt) < Date.now()) return null

  await client.execute({
    sql: `UPDATE "_base_api_keys" SET "lastUsedAt" = ? WHERE "id" = ?`,
    args: [Date.now(), String(row.id)],
  })

  const scopes = JSON.parse(String(row.scopes || '["collections:*"]')) as string[]
  const isAdmin = apiKeyHasScope(scopes, 'admin')
  return {
    id: `apikey:${row.id}`,
    name: String(row.name),
    role: isAdmin ? 'admin' : 'user',
    scopes,
  }
}

function rowToRecord(row: unknown): ApiKeyRecord {
  const r = row as Record<string, unknown>
  return {
    id: String(r.id),
    name: String(r.name),
    keyPrefix: String(r.keyPrefix),
    scopes: JSON.parse(String(r.scopes || '["*"]')) as string[],
    expiresAt: r.expiresAt != null ? Number(r.expiresAt) : null,
    lastUsedAt: r.lastUsedAt != null ? Number(r.lastUsedAt) : null,
    createdBy: r.createdBy ? String(r.createdBy) : null,
    createdAt: Number(r.createdAt),
    revokedAt: r.revokedAt != null ? Number(r.revokedAt) : null,
  }
}
