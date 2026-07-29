import { describe, expect, test, afterEach } from 'bun:test'
import {
  createTestContext,
  json,
  signUpAndIn,
  type TestContext,
} from './helpers/test-app.js'
import { defineCollection, f } from '../src/schema/define.js'

describe('join relations (in-data)', () => {
  let ctx: TestContext

  afterEach(() => {
    ctx?.cleanup()
  })

  test('?join=author embeds user on data.author (keeps authorId)', async () => {
    ctx = await createTestContext()
    const { cookie, userId } = await signUpAndIn(
      ctx.app,
      `join-${Date.now()}@example.com`,
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
      `http://localhost:3000/api/collections/posts/${created.data.id}?join=author`,
      { headers: { Cookie: cookie } },
    )
    expect(get.status).toBe(200)
    const body = await json<{
      data: {
        authorId?: string
        author?: { id?: string; email?: string }
        expand?: unknown
      }
    }>(get)

    expect(body.data.authorId).toBe(userId)
    expect(body.data.author?.id).toBe(userId)
    expect(body.data.expand).toBeUndefined()
  })

  test('?join=authorId also maps to data.author', async () => {
    ctx = await createTestContext()
    const { cookie, userId } = await signUpAndIn(
      ctx.app,
      `join2-${Date.now()}@example.com`,
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
          title: 'World',
          slug: `world-${Date.now()}`,
          authorId: userId,
        }),
      },
    )
    const created = await json<{ data: { id: string } }>(create)
    const get = await ctx.app.request(
      `http://localhost:3000/api/collections/posts/${created.data.id}?join=authorId`,
      { headers: { Cookie: cookie } },
    )
    const body = await json<{ data: { author?: { id?: string } } }>(get)
    expect(body.data.author?.id).toBe(userId)
  })

  test('reverse join embeds child array on data.<collection>', async () => {
    ctx = await createTestContext({
      collections: async () => {
        defineCollection('posts', {
          fields: {
            title: f.string().required(),
            slug: f.string().unique(),
            authorId: f.reference('user').required(),
          },
          access: {
            create: 'owner',
            read: 'owner',
            update: 'owner',
            delete: 'owner',
            ownerField: 'authorId',
          },
        })
        defineCollection('comments', {
          fields: {
            body: f.text().required(),
            postId: f.reference('posts').required(),
            authorId: f.reference('user').required(),
          },
          access: {
            create: 'owner',
            read: 'authenticated',
            update: 'owner',
            delete: 'owner',
            ownerField: 'authorId',
          },
        })
      },
    })

    const { cookie, userId } = await signUpAndIn(
      ctx.app,
      `join3-${Date.now()}@example.com`,
    )

    const postRes = await ctx.app.request(
      'http://localhost:3000/api/collections/posts',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: cookie,
        },
        body: JSON.stringify({
          title: 'Post',
          slug: `p-${Date.now()}`,
          authorId: userId,
        }),
      },
    )
    const post = await json<{ data: { id: string } }>(postRes)

    await ctx.app.request('http://localhost:3000/api/collections/comments', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookie,
      },
      body: JSON.stringify({
        body: 'Nice',
        postId: post.data.id,
        authorId: userId,
      }),
    })

    const get = await ctx.app.request(
      `http://localhost:3000/api/collections/posts/${post.data.id}?join=comments`,
      { headers: { Cookie: cookie } },
    )
    expect(get.status).toBe(200)
    const body = await json<{
      data: { comments?: Array<{ body?: string; postId?: string }> }
    }>(get)
    expect(Array.isArray(body.data.comments)).toBe(true)
    expect(body.data.comments?.length).toBe(1)
    expect(body.data.comments?.[0]?.body).toBe('Nice')
    expect(body.data.comments?.[0]?.postId).toBe(post.data.id)
  })
})
