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
  ]

  for (const stmt of statements) {
    try {
      await client.execute(stmt)
    } catch (err) {
      console.error('  ❌ Migration error:', err)
      throw err
    }
  }

  console.log(`  ✅ ${statements.length} tables verified/created`)
  console.log('✅ Auto-migration complete')
}
