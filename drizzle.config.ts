import { defineConfig } from 'drizzle-kit'

/**
 * Drizzle-kit config for Better Auth tables only.
 * User collections use runtime DDL + src/schema/evolve.ts.
 * Boot path: src/db/migrate.ts (raw SQL) — keep schema.ts in sync.
 */
export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'sqlite',
  dbCredentials: {
    url: process.env.DATABASE_URL || 'file:./data/app.db',
  },
  verbose: true,
  strict: true,
})
