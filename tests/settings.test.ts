import { describe, expect, test, afterEach } from 'bun:test'
import {
  createTestContext,
  json,
  type TestContext,
} from './helpers/test-app.js'

describe('settings + encryption', () => {
  let ctx: TestContext

  afterEach(() => {
    ctx?.cleanup()
  })

  test('GET settings returns resolved keys without secrets', async () => {
    ctx = await createTestContext()
    const res = await ctx.app.request('http://localhost:3000/api/admin/settings', {
      headers: {
        'X-Admin-Token':
          'test-admin-token-at-least-32-characters-long',
      },
    })
    expect(res.status).toBe(200)
    const body = await json<{
      data: {
        settings: Array<{ key: string; secret: boolean; displayValue: unknown }>
      }
    }>(res)
    expect(body.data.settings.length).toBeGreaterThan(5)
    const secret = body.data.settings.find((s) => s.key === 'oauth.github.clientSecret')
    expect(secret?.secret).toBe(true)
    expect(secret?.displayValue === '' || secret?.displayValue === '[REDACTED]').toBe(
      true,
    )
  })

  test('PATCH settings updates rate limit and audits', async () => {
    ctx = await createTestContext()
    const token = 'test-admin-token-at-least-32-characters-long'
    const res = await ctx.app.request('http://localhost:3000/api/admin/settings', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Token': token,
      },
      body: JSON.stringify({
        values: { 'rateLimit.max': 42, 'app.name': 'TestBase' },
      }),
    })
    expect(res.status).toBe(200)
    const body = await json<{ data: { updated: string[] } }>(res)
    expect(body.data.updated).toContain('rateLimit.max')

    const get = await ctx.app.request('http://localhost:3000/api/admin/settings', {
      headers: { 'X-Admin-Token': token },
    })
    const got = await json<{
      data: { settings: Array<{ key: string; displayValue: unknown }> }
    }>(get)
    const name = got.data.settings.find((s) => s.key === 'app.name')
    expect(name?.displayValue).toBe('TestBase')
  })

  test('dangerous setting requires confirm', async () => {
    ctx = await createTestContext()
    const res = await ctx.app.request('http://localhost:3000/api/admin/settings', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Token':
          'test-admin-token-at-least-32-characters-long',
      },
      body: JSON.stringify({
        values: { 'rateLimit.enabled': false },
      }),
    })
    expect(res.status).toBe(400)
    const body = await json<{ error: { code: string } }>(res)
    expect(body.error.code).toBe('CONFIRM_REQUIRED')
  })
})
