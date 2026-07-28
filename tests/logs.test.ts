import { describe, test, expect, afterEach } from 'bun:test'
import {
  createTestContext,
  json,
  type TestContext,
} from './helpers/test-app.js'

const TOKEN = 'test-admin-token-at-least-32-characters-long'

describe('HTTP logging', () => {
  let ctx: TestContext | undefined

  afterEach(() => {
    ctx?.cleanup()
    ctx = undefined
  })

  test('requests get X-Request-ID and appear in logs', async () => {
    ctx = await createTestContext()
    const health = await ctx.app.request('http://localhost:3000/api/health')
    expect(health.status).toBe(200)
    expect(health.headers.get('X-Request-ID')).toBeTruthy()

    // Give persist a moment
    await Bun.sleep(400)

    const logs = await ctx.app.request(
      'http://localhost:3000/api/admin/logs?kind=http',
      { headers: { 'X-Admin-Token': TOKEN } },
    )
    expect(logs.status).toBe(200)
    const body = await json<{ data: { kind: string; path?: string }[] }>(logs)
    expect(body.data.some((l) => l.path === '/api/health')).toBe(true)
  })
})
