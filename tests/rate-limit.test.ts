import { describe, test, expect, afterEach } from 'bun:test'
import {
  createTestContext,
  type TestContext,
} from './helpers/test-app.js'

describe('Rate limiting', () => {
  let ctx: TestContext | undefined

  afterEach(() => {
    ctx?.cleanup()
    ctx = undefined
  })

  test('returns 429 when limit exceeded', async () => {
    ctx = await createTestContext({
      env: {
        RATE_LIMIT_ENABLED: 'true',
        RATE_LIMIT_MAX: '3',
        RATE_LIMIT_WINDOW_MS: '60000',
      },
    })

    const statuses: number[] = []
    for (let i = 0; i < 5; i++) {
      const res = await ctx.app.request('http://localhost:3000/api/health')
      statuses.push(res.status)
    }
    expect(statuses.slice(0, 3).every((s) => s === 200)).toBe(true)
    expect(statuses.some((s) => s === 429)).toBe(true)
  })
})
