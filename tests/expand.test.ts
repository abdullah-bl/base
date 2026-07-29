import { describe, expect, test, afterEach } from 'bun:test'
import {
  createTestContext,
  json,
  signUpAndIn,
  type TestContext,
} from './helpers/test-app.js'

describe('expand relations', () => {
  let ctx: TestContext

  afterEach(() => {
    ctx?.cleanup()
  })

  test('?expand=authorId embeds user', async () => {
    ctx = await createTestContext()
    const { cookie, userId } = await signUpAndIn(
      ctx.app,
      `expand-${Date.now()}@example.com`,
    )

    const create = await ctx.app.request(
      'http://localhost:3000/api/collections/posts',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: cookie,
        },
        body: JSON.stringify({
          title: 'Hello',
          slug: `hello-${Date.now()}`,
          authorId: userId,
        }),
      },
    )
    expect(create.status).toBe(201)
    const created = await json<{ data: { id: string } }>(create)

    const get = await ctx.app.request(
      `http://localhost:3000/api/collections/posts/${created.data.id}?expand=authorId`,
      { headers: { Cookie: cookie } },
    )
    expect(get.status).toBe(200)
    const body = await json<{
      data: { expand?: { authorId?: { id?: string; email?: string } } }
    }>(get)
    expect(body.data.expand?.authorId?.id).toBe(userId)
  })
})
