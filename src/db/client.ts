import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import env from '../env.js';

let dbInstance: ReturnType<typeof drizzle> | null = null;

export function getDb() {
  if (!dbInstance) {
    const client = createClient({
      url: env.DATABASE_URL,
      authToken: env.DATABASE_AUTH_TOKEN,
    });

    // Enable WAL mode if using local file database
    if (env.DATABASE_URL.startsWith('file:')) {
      try {
        client.execute('PRAGMA journal_mode = WAL;');
        client.execute('PRAGMA synchronous = NORMAL;');
        console.log('✅ Database WAL mode enabled');
      } catch (error) {
        console.warn('⚠️  Failed to enable WAL mode:', error);
      }
    }

    dbInstance = drizzle(client);
    console.log('✅ Database client initialized');
  }

  return dbInstance;
}

// Export singleton instance
export const db = getDb();