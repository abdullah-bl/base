import { describe, test, expect, afterEach } from 'bun:test'
import {
  createTestContext,
  json,
  type TestContext,
} from './helpers/test-app.js'

const TOKEN = 'test-admin-token-at-least-32-characters-long'

describe('Admin data viewer', () => {
  let ctx: TestContext | undefined

  afterEach(() => {
    ctx?.cleanup()
    ctx = undefined
  })

  test('lists allowed tables', async () => {
    ctx = await createTestContext()
    const res = await ctx.app.request('http://localhost:3000/api/admin/data', {
      headers: { 'X-Admin-Token': TOKEN },
    })
    expect(res.status).toBe(200)
    const body = await json<{ data: string[] }>(res)
    expect(body.data).toContain('posts')
    expect(body.data).toContain('user')
    expect(body.data).toContain('_base_logs')
  })

  test('rejects SQL injection style table names', async () => {
    ctx = await createTestContext()
    const res = await ctx.app.request(
      'http://localhost:3000/api/admin/data/posts%3BDROP%20TABLE%20user',
      { headers: { 'X-Admin-Token': TOKEN } },
    )
    expect([400, 403]).toContain(res.status)
  })

  test('rejects unknown tables', async () => {
    ctx = await createTestContext()
    const res = await ctx.app.request(
      'http://localhost:3000/api/admin/data/not_a_real_table',
      { headers: { 'X-Admin-Token': TOKEN } },
    )
    expect(res.status).toBe(403)
  })

  test('SQL console rejects write without confirm', async () => {
    ctx = await createTestContext()
    const res = await ctx.app.request('http://localhost:3000/api/admin/sql', {
      method: 'POST',
      headers: {
        'X-Admin-Token': TOKEN,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ sql: 'DELETE FROM posts' }),
    })
    expect(res.status).toBe(400)
    const body = await json<{ error: { code: string } }>(res)
    expect(body.error.code).toBe('CONFIRM_REQUIRED')
  })

  test('SQL console allows SELECT', async () => {
    ctx = await createTestContext()
    const res = await ctx.app.request('http://localhost:3000/api/admin/sql', {
      method: 'POST',
      headers: {
        'X-Admin-Token': TOKEN,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ sql: 'SELECT 1 as n' }),
    })
    expect(res.status).toBe(200)
    const body = await json<{ data: { rows: { n: number }[]; readonly: boolean } }>(
      res,
    )
    expect(body.data.readonly).toBe(true)
    expect(Number(body.data.rows[0].n)).toBe(1)
  })
})
