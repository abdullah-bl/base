import { describe, test, expect, afterEach } from 'bun:test'
import {
  createTestContext,
  signUpAndIn,
  type TestContext,
} from './helpers/test-app'

describe('Auth (production wiring)', () => {
  let ctx: TestContext
  afterEach(() => ctx?.cleanup())

  test('requireAuth blocks unauthenticated /api/auth/me', async () => {
    ctx = await createTestContext()
    const res = await ctx.app.request('/api/auth/me')
    expect(res.status).toBe(401)
  })

  test('sign-up and sign-in establish a session cookie', async () => {
    ctx = await createTestContext()
    const { cookie, userId } = await signUpAndIn(
      ctx.app,
      `auth-${Date.now()}@test.com`,
    )
    expect(cookie.length).toBeGreaterThan(0)
    expect(userId).toBeTruthy()

    const me = await ctx.app.request('/api/auth/me', {
      headers: { Cookie: cookie },
    })
    expect(me.status).toBe(200)
  })

  test('get-session endpoint responds', async () => {
    ctx = await createTestContext()
    const { cookie } = await signUpAndIn(ctx.app, `sess-${Date.now()}@test.com`)

    const res = await ctx.app.request('/api/auth/get-session', {
      headers: { Cookie: cookie },
    })
    // Better Auth 1.x uses get-session
    expect(res.status).toBeLessThan(500)
    if (res.status === 200) {
      const body = await res.json()
      expect(body).toBeDefined()
    }
  })
})
