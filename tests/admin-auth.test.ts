import { describe, test, expect, afterEach } from 'bun:test'
import {
  createTestContext,
  json,
  signUpAndIn,
  type TestContext,
} from './helpers/test-app.js'

describe('Admin auth', () => {
  let ctx: TestContext | undefined

  afterEach(() => {
    ctx?.cleanup()
    ctx = undefined
  })

  test('first registered user becomes admin', async () => {
    ctx = await createTestContext()
    const { cookie } = await signUpAndIn(
      ctx.app,
      `admin-${Date.now()}@test.com`,
    )
    const me = await json<{ user: { role: string } }>(
      await ctx.app.request('http://localhost:3000/api/auth/me', {
        headers: { Cookie: cookie },
      }),
    )
    expect(me.user.role).toBe('admin')

    const overview = await ctx.app.request(
      'http://localhost:3000/api/admin/overview',
      { headers: { Cookie: cookie } },
    )
    expect(overview.status).toBe(200)
  })

  test('non-admin is forbidden from admin API', async () => {
    ctx = await createTestContext()
    // First user is admin
    await signUpAndIn(ctx.app, `first-${Date.now()}@test.com`)
    // Second user is regular
    const { cookie } = await signUpAndIn(
      ctx.app,
      `user-${Date.now()}@test.com`,
    )
    const me = await json<{ user: { role: string } }>(
      await ctx.app.request('http://localhost:3000/api/auth/me', {
        headers: { Cookie: cookie },
      }),
    )
    expect(me.user.role).toBe('user')

    const res = await ctx.app.request(
      'http://localhost:3000/api/admin/overview',
      { headers: { Cookie: cookie } },
    )
    expect(res.status).toBe(403)
  })

  test('ADMIN_TOKEN grants admin access via X-Admin-Token', async () => {
    ctx = await createTestContext()
    const res = await ctx.app.request(
      'http://localhost:3000/api/admin/overview',
      {
        headers: {
          'X-Admin-Token':
            'test-admin-token-at-least-32-characters-long',
        },
      },
    )
    expect(res.status).toBe(200)
    const body = await json<{ data: { version: string } }>(res)
    expect(body.data.version).toBe('0.1.0')
  })

  test('invalid admin token is rejected', async () => {
    ctx = await createTestContext()
    const res = await ctx.app.request(
      'http://localhost:3000/api/admin/overview',
      { headers: { 'X-Admin-Token': 'wrong-token-wrong-token-wrong-tok' } },
    )
    expect(res.status).toBe(401)
  })
})
