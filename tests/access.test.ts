import { describe, test, expect, afterEach } from 'bun:test'
import {
  createTestContext,
  signUpAndIn,
  json,
  type TestContext,
} from './helpers/test-app'

describe('Access rules', () => {
  let ctx: TestContext
  afterEach(() => ctx?.cleanup())

  test('owner assignment ignores client-supplied authorId', async () => {
    ctx = await createTestContext()
    const a = await signUpAndIn(ctx.app, `own-${Date.now()}@test.com`)
    const res = await ctx.app.request('/api/collections/posts', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: a.cookie,
      },
      body: JSON.stringify({
        title: 'Owned',
        slug: `owned-${Date.now()}`,
        authorId: 'someone-else',
      }),
    })
    const body = await json(res)
    expect(body.data.authorId).toBe(a.userId)
  })

  test('cross-user update forbidden', async () => {
    ctx = await createTestContext()
    const a = await signUpAndIn(ctx.app, `ua-${Date.now()}@test.com`)
    const b = await signUpAndIn(ctx.app, `ub-${Date.now()}@test.com`)

    const created = await ctx.app.request('/api/collections/posts', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: a.cookie,
      },
      body: JSON.stringify({ title: 'X', slug: `x-${Date.now()}` }),
    })
    const id = (await json(created)).data.id as string

    const patch = await ctx.app.request(`/api/collections/posts/${id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Cookie: b.cookie,
      },
      body: JSON.stringify({ title: 'Hacked' }),
    })
    expect([403, 404]).toContain(patch.status)
  })
})
