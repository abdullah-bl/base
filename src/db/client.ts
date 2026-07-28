import { createClient, type Client } from '@libsql/client'
import { drizzle, type LibSQLDatabase } from 'drizzle-orm/libsql'
import env from '../env.js'
import { ensureDirectories } from '../config.js'

let clientInstance: Client | null = null
let dbInstance: LibSQLDatabase | null = null
let initialized = false

export function getClient(): Client {
  if (!clientInstance) {
    ensureDirectories()
    clientInstance = createClient({
      url: env.DATABASE_URL,
      authToken: env.DATABASE_AUTH_TOKEN,
    })
  }
  return clientInstance
}

export function getDb(): LibSQLDatabase {
  if (!dbInstance) {
    dbInstance = drizzle(getClient())
  }
  return dbInstance
}

/**
 * Initialize the database client: enable WAL for local file DBs.
 * Must be awaited before migrations / serving requests.
 */
export async function initDb(): Promise<Client> {
  const client = getClient()
  if (initialized) return client

  if (env.DATABASE_URL.startsWith('file:')) {
    try {
      await client.execute('PRAGMA journal_mode = WAL;')
      await client.execute('PRAGMA synchronous = NORMAL;')
      console.log('✅ Database WAL mode enabled')
    } catch (error) {
      console.warn('⚠️  Failed to enable WAL mode:', error)
    }
  }

  initialized = true
  console.log('✅ Database client initialized')
  return client
}

/** Override client for isolated tests */
export function setClientForTests(client: Client): void {
  clientInstance = client
  dbInstance = drizzle(client)
  initialized = true
}

/** Reset singleton state for tests */
export function resetClientForTests(): void {
  if (clientInstance) {
    try {
      clientInstance.close()
    } catch {
      // ignore close errors in tests
    }
  }
  clientInstance = null
  dbInstance = null
  initialized = false
}

/** Lazy singleton for production import sites */
export const db = new Proxy({} as LibSQLDatabase, {
  get(_target, prop, receiver) {
    const instance = getDb()
    const value = Reflect.get(instance as object, prop, receiver)
    return typeof value === 'function' ? value.bind(instance) : value
  },
})
