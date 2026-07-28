import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'

/**
 * Better Auth required tables.
 * These are auto-managed by Better Auth — do not modify column names.
 * Better Auth Drizzle adapter requires these to exist in the schema object.
 */
export const user = sqliteTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: integer('emailVerified', { mode: 'boolean' }).notNull().default(false),
  image: text('image'),
  createdAt: integer('createdAt').notNull().default(0),
  updatedAt: integer('updatedAt').notNull().default(0),
})

export const session = sqliteTable('session', {
  id: text('id').primaryKey(),
  expiresAt: integer('expiresAt').notNull(),
  token: text('token').notNull().unique(),
  createdAt: integer('createdAt').notNull().default(0),
  updatedAt: integer('updatedAt').notNull().default(0),
  ipAddress: text('ipAddress'),
  userAgent: text('userAgent'),
  userId: text('userId').notNull().references(() => user.id, { onDelete: 'cascade' }),
})

export const account = sqliteTable('account', {
  id: text('id').primaryKey(),
  accountId: text('accountId').notNull(),
  providerId: text('providerId').notNull(),
  userId: text('userId').notNull().references(() => user.id, { onDelete: 'cascade' }),
  accessToken: text('accessToken'),
  refreshToken: text('refreshToken'),
  idToken: text('idToken'),
  accessTokenExpiresAt: integer('accessTokenExpiresAt'),
  refreshTokenExpiresAt: integer('refreshTokenExpiresAt'),
  scope: text('scope'),
  password: text('password'),
  createdAt: integer('createdAt').notNull().default(0),
  updatedAt: integer('updatedAt').notNull().default(0),
})

export const verification = sqliteTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: integer('expiresAt').notNull(),
  createdAt: integer('createdAt'),
  updatedAt: integer('updatedAt'),
})

/**
 * Full schema object — used by Drizzle adapter for Better Auth
 * and by drizzle-kit for migrations.
 */
export const schema = {
  user,
  session,
  account,
  verification,
}

export type Schema = typeof schema
