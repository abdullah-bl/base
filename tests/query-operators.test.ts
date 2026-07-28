import { describe, test, expect, afterEach } from 'bun:test'
import {
  createTestContext,
  json,
  signUpAndIn,
  type TestContext,
} from './helpers/test-app.js'

describe('Query operators', () => {
  let ctx: TestContext | undefined

  afterEach(() => {
    ctx?.cleanup()
    ctx = undefined
  })

  test('supports gte / like / ne filters', async () => {
    ctx = await createTestContext()
    const { cookie } = await signUpAndIn(
      ctx.app,
      `qop-${Date.now()}@test.com`,
    )

    for (const [title, views] of [
      ['Alpha', 5],
      ['Beta', 15],
      ['Gamma', 25],
    ] as const) {
      await ctx.app.request('http://localhost:3000/api/collections/posts', {
        method: 'POST',
        headers: {
          Cookie: cookie,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title,
          slug: `${title.toLowerCase()}-${Date.now()}-${views}`,
          viewCount: views,
        }),
      })
    }

    const gte = await json<{ data: { title: string }[] }>(
      await ctx.app.request(
        `http://localhost:3000/api/collections/posts?filter=${encodeURIComponent(
          JSON.stringify({ viewCount__gte: 15 }),
        )}`,
        { headers: { Cookie: cookie } },
      ),
    )
    expect(gte.data.length).toBe(2)

    const like = await json<{ data: { title: string }[] }>(
      await ctx.app.request(
        `http://localhost:3000/api/collections/posts?filter=${encodeURIComponent(
          JSON.stringify({ title__like: '%lph%' }),
        )}`,
        { headers: { Cookie: cookie } },
      ),
    )
    expect(like.data.length).toBe(1)
    expect(like.data[0].title).toBe('Alpha')

    const search = await json<{ data: { title: string }[] }>(
      await ctx.app.request(
        'http://localhost:3000/api/collections/posts?search=Beta',
        { headers: { Cookie: cookie } },
      ),
    )
    expect(search.data.some((r) => r.title === 'Beta')).toBe(true)
  })
})
