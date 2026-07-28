import { describe, test, expect, afterEach } from 'bun:test'
import {
  createTestContext,
  type TestContext,
} from './helpers/test-app'

describe('Generated client contract', () => {
  let ctx: TestContext
  afterEach(() => ctx?.cleanup())

  test('BaseClient create/list/get against live app', async () => {
    ctx = await createTestContext()

    await Bun.$`bun run scripts/generate-client.ts`.quiet()

    const { BaseClient } = await import('../src/client/generated.js')

    const client = new BaseClient({
      baseUrl: 'http://localhost:3000',
      fetch: ((input: string | URL | Request, init?: RequestInit) => {
        const url =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url
        const path = url.replace('http://localhost:3000', '')
        return ctx.app.request(path || '/', init)
      }) as typeof fetch,
    })

    const email = `client-${Date.now()}@test.com`
    await client.signUp({
      email,
      password: 'password123',
      name: 'Client User',
    })
    await client.signIn({ email, password: 'password123' })

    const created = await client.posts.create({
      title: 'From client',
      slug: `client-${Date.now()}`,
    })
    expect(created.title).toBe('From client')
    expect(created.id).toBeTruthy()

    const listed = await client.posts.list({ sort: '-createdAt' })
    expect(listed.data.length).toBeGreaterThanOrEqual(1)
    expect(listed.meta.total).toBeGreaterThanOrEqual(1)

    const got = await client.posts.get(created.id)
    expect(got.id).toBe(created.id)
  })
})
