import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';

// Use a temporary database for tests
const TEST_DB_URL = 'file:./data/test.db';

describe('Auth Layer Tests', () => {
  let testAuth: any;
  let testDb: ReturnType<typeof drizzle>;

  beforeEach(async () => {
    // Create a fresh database for each test
    const client = createClient({ url: TEST_DB_URL });
    testDb = drizzle(client);

    // Initialize Better Auth with test database
    testAuth = betterAuth({
      database: drizzleAdapter(testDb, { provider: 'sqlite' }),
      baseURL: 'http://localhost:3000',
      secret: 'test-secret-for-testing-only',
      emailAndPassword: { enabled: true },
      session: { expiresIn: 60 * 60 * 24 * 7 }, // 7 days
    });
  });

  afterEach(async () => {
    // Clean up test database
    try {
      const client = (testDb as any)._$client;
      if (client && client.close) {
        await client.close();
      }
    } catch (error) {
      console.warn('Error closing test database:', error);
    }
  });

  test('auth instance is created correctly', () => {
    expect(testAuth).toBeDefined();
    expect(testAuth.api).toBeDefined();
    expect(testAuth.handler).toBeDefined();
  });

  test('getSession returns null for unauthenticated request', async () => {
    const result = await testAuth.api.getSession({
      headers: new Headers(),
    });

    expect(result).toBeNull();
  });

  test('getSession accepts headers object', async () => {
    // This test verifies the API accepts the shape we use in middleware
    const result = await testAuth.api.getSession({
      headers: new Headers({ 'content-type': 'application/json' }),
    });

    // Should return null since no session cookie
    expect(result).toBeNull();
  });

  describe('Auth handler responds to requests', () => {
    test('auth handler exists and is callable', async () => {
      expect(typeof testAuth.handler).toBe('function');

      // Test with a basic request
      const request = new Request('http://localhost:3000/api/auth/session', {
        method: 'GET',
      });

      const response = await testAuth.handler(request);
      expect(response).toBeDefined();
      expect(response instanceof Response).toBe(true);
    });

    test('auth handler handles unknown routes gracefully', async () => {
      const request = new Request('http://localhost:3000/api/auth/unknown', {
        method: 'GET',
      });

      const response = await testAuth.handler(request);
      expect(response).toBeDefined();
    });
  });
});