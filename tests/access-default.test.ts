import { describe, expect, test, afterEach } from 'bun:test'
import {
  createTestContext,
  json,
  type TestContext,
} from './helpers/test-app.js'

describe('access defaults', () => {
  let ctx: TestContext

  afterEach(() => {
    ctx?.cleanup()
  })

  test('GET posts without auth is rejected (owner/authenticated)', async () => {
    ctx = await createTestContext()
    const res = await ctx.app.request(
      'http://localhost:3000/api/collections/posts',
    )
    expect(res.status).toBe(401)
    const body = await json<{ error: { code: string } }>(res)
    expect(body.error.code).toBe('UNAUTHORIZED')
  })

  test('bracket filter syntax works', async () => {
    ctx = await createTestContext()
    const { signUpAndIn } = await import('./helpers/test-app.js')
    const { cookie, userId } = await signUpAndIn(
      ctx.app,
      `filter-${Date.now()}@example.com`,
    )
    await ctx.app.request('http://localhost:3000/api/collections/posts', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookie,
      },
      body: JSON.stringify({
        title: 'Draft',
        slug: `draft-${Date.now()}`,
        published: false,
        authorId: userId,
      }),
    })

    const res = await ctx.app.request(
      'http://localhost:3000/api/collections/posts?filter[published]=false',
      { headers: { Cookie: cookie } },
    )
    expect(res.status).toBe(200)
    const body = await json<{ data: unknown[] }>(res)
    expect(body.data.length).toBeGreaterThanOrEqual(1)
  })
})
