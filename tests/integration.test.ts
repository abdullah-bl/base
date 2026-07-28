import { describe, test, expect, afterEach } from 'bun:test'
import {
  createTestContext,
  signUpAndIn,
  json,
  type TestContext,
} from './helpers/test-app'

describe('Integration: auth + CRUD + files', () => {
  let ctx: TestContext

  afterEach(() => {
    ctx?.cleanup()
  })

  test('health endpoint', async () => {
    ctx = await createTestContext()
    const res = await ctx.app.request('/api/health')
    expect(res.status).toBe(200)
    const body = await json(res)
    expect(body.status).toBe('ok')
  })

  test('unauthenticated collection access returns 401', async () => {
    ctx = await createTestContext()
    const res = await ctx.app.request('/api/collections/posts')
    expect(res.status).toBe(401)
    const body = await json(res)
    expect(body.error.code).toBe('UNAUTHORIZED')
  })

  test('sign-up, sign-in, session, and /api/auth/me', async () => {
    ctx = await createTestContext()
    const { cookie, userId } = await signUpAndIn(
      ctx.app,
      `user-${Date.now()}@test.com`,
    )
    expect(cookie).toBeTruthy()
    expect(userId).toBeTruthy()

    const session = await ctx.app.request('/api/auth/get-session', {
      headers: { Cookie: cookie },
    })
    const sessionAlt =
      session.status === 404
        ? await ctx.app.request('/api/auth/session', {
            headers: { Cookie: cookie },
          })
        : session
    expect(sessionAlt.status).toBeLessThan(500)

    const me = await ctx.app.request('/api/auth/me', {
      headers: { Cookie: cookie },
    })
    expect(me.status).toBe(200)
    const meBody = await json(me)
    expect(meBody.user.email).toContain('@test.com')
  })

  test('CRUD round trip with owner access', async () => {
    ctx = await createTestContext()
    const a = await signUpAndIn(ctx.app, `a-${Date.now()}@test.com`)
    const b = await signUpAndIn(ctx.app, `b-${Date.now()}@test.com`)

    const createRes = await ctx.app.request('/api/collections/posts', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: a.cookie,
      },
      body: JSON.stringify({
        title: 'Hello',
        slug: `hello-${Date.now()}`,
        authorId: 'spoofed-should-be-overwritten',
        published: true,
        meta: { tags: ['x'] },
        embedding: [0.1, 0.2, 0.3],
      }),
    })
    expect(createRes.status).toBe(201)
    const created = await json(createRes)
    expect(created.data.title).toBe('Hello')
    expect(created.data.authorId).toBe(a.userId)
    expect(created.data.published).toBe(true)
    expect(created.data.meta).toEqual({ tags: ['x'] })
    expect(created.data.embedding).toEqual([0.1, 0.2, 0.3])

    const id = created.data.id as string

    const listA = await ctx.app.request('/api/collections/posts', {
      headers: { Cookie: a.cookie },
    })
    expect(listA.status).toBe(200)
    const listABody = await json(listA)
    expect(listABody.data.length).toBe(1)
    expect(listABody.meta.total).toBe(1)

    const listB = await ctx.app.request('/api/collections/posts', {
      headers: { Cookie: b.cookie },
    })
    const listBBody = await json(listB)
    expect(listBBody.data.length).toBe(0)

    const getB = await ctx.app.request(`/api/collections/posts/${id}`, {
      headers: { Cookie: b.cookie },
    })
    expect([403, 404]).toContain(getB.status)

    const patch = await ctx.app.request(`/api/collections/posts/${id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Cookie: a.cookie,
      },
      body: JSON.stringify({ title: 'Updated' }),
    })
    expect(patch.status).toBe(200)
    const patched = await json(patch)
    expect(patched.data.title).toBe('Updated')

    const del = await ctx.app.request(`/api/collections/posts/${id}`, {
      method: 'DELETE',
      headers: { Cookie: a.cookie },
    })
    expect(del.status).toBe(200)
    const delBody = await json(del)
    expect(delBody.data.soft).toBe(true)

    const getGone = await ctx.app.request(`/api/collections/posts/${id}`, {
      headers: { Cookie: a.cookie },
    })
    expect(getGone.status).toBe(404)
  })

  test('JSON filter and bracket filter', async () => {
    ctx = await createTestContext()
    const a = await signUpAndIn(ctx.app, `f-${Date.now()}@test.com`)
    const slug = `slug-${Date.now()}`

    await ctx.app.request('/api/collections/posts', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: a.cookie,
      },
      body: JSON.stringify({ title: 'Filter me', slug }),
    })

    const jsonFilter = await ctx.app.request(
      `/api/collections/posts?filter=${encodeURIComponent(JSON.stringify({ slug }))}`,
      { headers: { Cookie: a.cookie } },
    )
    expect(jsonFilter.status).toBe(200)
    const jsonBody = await json(jsonFilter)
    expect(jsonBody.data.length).toBe(1)

    const bracketFilter = await ctx.app.request(
      `/api/collections/posts?filter[slug]=${encodeURIComponent(slug)}`,
      { headers: { Cookie: a.cookie } },
    )
    expect(bracketFilter.status).toBe(200)
    const bracketBody = await json(bracketFilter)
    expect(bracketBody.data.length).toBe(1)
  })

  test('hard delete denied by default', async () => {
    ctx = await createTestContext()
    const a = await signUpAndIn(ctx.app, `h-${Date.now()}@test.com`)
    const createRes = await ctx.app.request('/api/collections/posts', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: a.cookie,
      },
      body: JSON.stringify({ title: 'Hard', slug: `hard-${Date.now()}` }),
    })
    const id = (await json(createRes)).data.id as string

    const hard = await ctx.app.request(
      `/api/collections/posts/${id}?hard=true`,
      {
        method: 'DELETE',
        headers: { Cookie: a.cookie },
      },
    )
    expect(hard.status).toBe(403)
    const body = await json(hard)
    expect(body.error.code).toBe('HARD_DELETE_DISABLED')
  })

  test('file upload ownership', async () => {
    ctx = await createTestContext()
    const a = await signUpAndIn(ctx.app, `fa-${Date.now()}@test.com`)
    const b = await signUpAndIn(ctx.app, `fb-${Date.now()}@test.com`)

    const form = new FormData()
    form.append(
      'file',
      new File(['hello world'], 'hello.txt', { type: 'text/plain' }),
    )

    const upload = await ctx.app.request('/api/files', {
      method: 'POST',
      headers: { Cookie: a.cookie },
      body: form,
    })
    expect(upload.status).toBe(201)
    const uploaded = await json(upload)
    const fileId = uploaded.data.id as string
    expect(uploaded.data.uploaderId).toBe(a.userId)

    const forbidden = await ctx.app.request(`/api/files/${fileId}`, {
      headers: { Cookie: b.cookie },
    })
    expect(forbidden.status).toBe(403)

    const ok = await ctx.app.request(`/api/files/${fileId}`, {
      headers: { Cookie: a.cookie },
    })
    expect(ok.status).toBe(200)
    const text = await ok.text()
    expect(text).toBe('hello world')

    const delForbidden = await ctx.app.request(`/api/files/${fileId}`, {
      method: 'DELETE',
      headers: { Cookie: b.cookie },
    })
    expect(delForbidden.status).toBe(403)

    const del = await ctx.app.request(`/api/files/${fileId}`, {
      method: 'DELETE',
      headers: { Cookie: a.cookie },
    })
    expect(del.status).toBe(200)
  })

  test('validation error envelope', async () => {
    ctx = await createTestContext()
    const a = await signUpAndIn(ctx.app, `v-${Date.now()}@test.com`)
    const res = await ctx.app.request('/api/collections/posts', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: a.cookie,
      },
      body: JSON.stringify({ viewCount: 'nope' }),
    })
    expect(res.status).toBe(400)
    const body = await json(res)
    expect(body.error.code).toBe('VALIDATION_ERROR')
  })
})
