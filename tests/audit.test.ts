import { describe, test, expect, afterEach } from 'bun:test'
import {
  createTestContext,
  json,
  signUpAndIn,
  type TestContext,
} from './helpers/test-app.js'

const TOKEN = 'test-admin-token-at-least-32-characters-long'

describe('Audit trail', () => {
  let ctx: TestContext | undefined

  afterEach(() => {
    ctx?.cleanup()
    ctx = undefined
  })

  test('collection create writes audit entry', async () => {
    ctx = await createTestContext()
    const { cookie } = await signUpAndIn(
      ctx.app,
      `audit-${Date.now()}@test.com`,
    )

    const create = await ctx.app.request(
      'http://localhost:3000/api/collections/posts',
      {
        method: 'POST',
        headers: {
          Cookie: cookie,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ title: 'Audited post', slug: `a-${Date.now()}` }),
      },
    )
    expect(create.status).toBe(201)

    const audit = await ctx.app.request(
      'http://localhost:3000/api/admin/audit?action=create&collection=posts',
      { headers: { 'X-Admin-Token': TOKEN } },
    )
    expect(audit.status).toBe(200)
    const body = await json<{ data: { action: string; collection: string }[] }>(
      audit,
    )
    expect(body.data.length).toBeGreaterThan(0)
    expect(body.data[0].action).toBe('create')
    expect(body.data[0].collection).toBe('posts')
  })
})
