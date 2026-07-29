import { getClient } from './client.js'

/**
 * Auto-migrate: create Better Auth tables if they don't exist.
 *
 * Single source of truth for auth table DDL at boot.
 * Drizzle schema in schema.ts mirrors these definitions for the Better Auth adapter.
 * Prefer this boot path over drizzle-kit for auth tables; use schema evolution
 * (src/schema/evolve.ts) for user collections.
 */
export async function autoMigrate(): Promise<void> {
  console.log('🔄 Running auto-migration...')

  const client = getClient()

  const statements = [
    `CREATE TABLE IF NOT EXISTS "user" (
      "id" TEXT PRIMARY KEY NOT NULL,
      "name" TEXT NOT NULL,
      "email" TEXT NOT NULL UNIQUE,
      "emailVerified" INTEGER NOT NULL DEFAULT 0,
      "image" TEXT,
      "role" TEXT NOT NULL DEFAULT 'user',
      "createdAt" INTEGER NOT NULL DEFAULT 0,
      "updatedAt" INTEGER NOT NULL DEFAULT 0
    )`,
    `CREATE TABLE IF NOT EXISTS "session" (
      "id" TEXT PRIMARY KEY NOT NULL,
      "expiresAt" INTEGER NOT NULL,
      "token" TEXT NOT NULL UNIQUE,
      "createdAt" INTEGER NOT NULL DEFAULT 0,
      "updatedAt" INTEGER NOT NULL DEFAULT 0,
      "ipAddress" TEXT,
      "userAgent" TEXT,
      "userId" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS "account" (
      "id" TEXT PRIMARY KEY NOT NULL,
      "accountId" TEXT NOT NULL,
      "providerId" TEXT NOT NULL,
      "userId" TEXT NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
      "accessToken" TEXT,
      "refreshToken" TEXT,
      "idToken" TEXT,
      "accessTokenExpiresAt" INTEGER,
      "refreshTokenExpiresAt" INTEGER,
      "scope" TEXT,
      "password" TEXT,
      "createdAt" INTEGER NOT NULL DEFAULT 0,
      "updatedAt" INTEGER NOT NULL DEFAULT 0
    )`,
    `CREATE TABLE IF NOT EXISTS "verification" (
      "id" TEXT PRIMARY KEY NOT NULL,
      "identifier" TEXT NOT NULL,
      "value" TEXT NOT NULL,
      "expiresAt" INTEGER NOT NULL,
      "createdAt" INTEGER,
      "updatedAt" INTEGER
    )`,
    // Internal schema metadata for collection evolution
    `CREATE TABLE IF NOT EXISTS "_base_schema" (
      "collection" TEXT PRIMARY KEY NOT NULL,
      "fingerprint" TEXT NOT NULL,
      "schemaJson" TEXT NOT NULL,
      "updatedAt" INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS "_base_migrations" (
      "id" TEXT PRIMARY KEY NOT NULL,
      "collection" TEXT NOT NULL,
      "operation" TEXT NOT NULL,
      "detail" TEXT NOT NULL,
      "appliedAt" INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS "_base_logs" (
      "id" TEXT PRIMARY KEY NOT NULL,
      "ts" INTEGER NOT NULL,
      "level" TEXT NOT NULL,
      "kind" TEXT NOT NULL,
      "message" TEXT NOT NULL,
      "method" TEXT,
      "path" TEXT,
      "status" INTEGER,
      "durationMs" INTEGER,
      "requestId" TEXT,
      "userId" TEXT,
      "ip" TEXT,
      "userAgent" TEXT,
      "meta" TEXT
    )`,
    `CREATE INDEX IF NOT EXISTS "idx_base_logs_ts" ON "_base_logs" ("ts")`,
    `CREATE INDEX IF NOT EXISTS "idx_base_logs_level" ON "_base_logs" ("level")`,
    `CREATE TABLE IF NOT EXISTS "_base_audit" (
      "id" TEXT PRIMARY KEY NOT NULL,
      "ts" INTEGER NOT NULL,
      "actorId" TEXT,
      "actorKind" TEXT NOT NULL,
      "action" TEXT NOT NULL,
      "collection" TEXT,
      "recordId" TEXT,
      "before" TEXT,
      "after" TEXT,
      "ip" TEXT,
      "requestId" TEXT
    )`,
    `CREATE INDEX IF NOT EXISTS "idx_base_audit_ts" ON "_base_audit" ("ts")`,
    `CREATE TABLE IF NOT EXISTS "_base_api_keys" (
      "id" TEXT PRIMARY KEY NOT NULL,
      "name" TEXT NOT NULL,
      "keyHash" TEXT NOT NULL UNIQUE,
      "keyPrefix" TEXT NOT NULL,
      "scopes" TEXT NOT NULL DEFAULT '["*"]',
      "expiresAt" INTEGER,
      "lastUsedAt" INTEGER,
      "createdBy" TEXT,
      "createdAt" INTEGER NOT NULL,
      "revokedAt" INTEGER
    )`,
    `CREATE TABLE IF NOT EXISTS "_base_webhooks" (
      "id" TEXT PRIMARY KEY NOT NULL,
      "url" TEXT NOT NULL,
      "secret" TEXT,
      "collections" TEXT NOT NULL DEFAULT '["*"]',
      "enabled" INTEGER NOT NULL DEFAULT 1,
      "createdAt" INTEGER NOT NULL,
      "updatedAt" INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS "_base_settings" (
      "key" TEXT PRIMARY KEY NOT NULL,
      "value" TEXT NOT NULL,
      "encrypted" INTEGER NOT NULL DEFAULT 0,
      "updatedAt" INTEGER NOT NULL,
      "updatedBy" TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS "_base_collections" (
      "id" TEXT PRIMARY KEY NOT NULL,
      "name" TEXT NOT NULL UNIQUE,
      "schemaJson" TEXT NOT NULL,
      "draftJson" TEXT,
      "version" INTEGER NOT NULL DEFAULT 1,
      "fingerprint" TEXT NOT NULL,
      "updatedAt" INTEGER NOT NULL,
      "updatedBy" TEXT
    )`,
    `CREATE INDEX IF NOT EXISTS "idx_base_collections_name" ON "_base_collections" ("name")`,
    `CREATE TABLE IF NOT EXISTS "_base_restart_jobs" (
      "id" TEXT PRIMARY KEY NOT NULL,
      "status" TEXT NOT NULL,
      "reason" TEXT,
      "actorId" TEXT,
      "actorKind" TEXT,
      "error" TEXT,
      "createdAt" INTEGER NOT NULL,
      "updatedAt" INTEGER NOT NULL,
      "finishedAt" INTEGER
    )`,
    `CREATE TABLE IF NOT EXISTS "_base_onboarding" (
      "id" TEXT PRIMARY KEY NOT NULL DEFAULT 'default',
      "setupTokenHash" TEXT,
      "completedAt" INTEGER,
      "createdAt" INTEGER NOT NULL
    )`,
  ]

  for (const stmt of statements) {
    try {
      await client.execute(stmt)
    } catch (err) {
      console.error('  ❌ Migration error:', err)
      throw err
    }
  }

  // Additive column for existing DBs created before role existed
  await ensureColumn(client, 'user', 'role', `TEXT NOT NULL DEFAULT 'user'`)

  console.log(`  ✅ ${statements.length} statements verified/created`)
  console.log('✅ Auto-migration complete')
}

async function ensureColumn(
  client: ReturnType<typeof getClient>,
  table: string,
  column: string,
  definition: string,
): Promise<void> {
  const info = await client.execute(`PRAGMA table_info("${table}")`)
  const cols = new Set(
    (info.rows || []).map((r) =>
      String((r as unknown as { name: string }).name),
    ),
  )
  if (!cols.has(column)) {
    await client.execute(
      `ALTER TABLE "${table}" ADD COLUMN "${column}" ${definition}`,
    )
    console.log(`  ✅ Added column ${table}.${column}`)
  }
}
