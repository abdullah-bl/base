import { describe, expect, test, afterEach } from 'bun:test'
import {
  createTestContext,
  json,
  type TestContext,
} from './helpers/test-app.js'

describe('DB-backed schema store', () => {
  let ctx: TestContext

  afterEach(() => {
    ctx?.cleanup()
  })

  test('can create collection via admin API without collections.ts', async () => {
    ctx = await createTestContext()
    const token = 'test-admin-token-at-least-32-characters-long'
    const res = await ctx.app.request(
      'http://localhost:3000/api/admin/schema/collections/notes',
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-Admin-Token': token,
        },
        body: JSON.stringify({
          name: 'notes',
          fields: {
            body: {
              type: 'text',
              required: true,
              optional: false,
              unique: false,
            },
            authorId: {
              type: 'reference',
              required: true,
              optional: false,
              unique: false,
              ref: 'user',
            },
          },
          indexes: [],
          access: {
            create: 'owner',
            read: 'authenticated',
            update: 'owner',
            delete: 'owner',
            ownerField: 'authorId',
          },
        }),
      },
    )
    expect(res.status).toBe(200)
    const body = await json<{ data: { collection: { name: string } } }>(res)
    expect(body.data.collection.name).toBe('notes')

    const list = await ctx.app.request(
      'http://localhost:3000/api/admin/schema/collections',
      { headers: { 'X-Admin-Token': token } },
    )
    const listed = await json<{ data: Array<{ name: string }> }>(list)
    expect(listed.data.some((c) => c.name === 'notes')).toBe(true)
  })

  test('export schema JSON', async () => {
    ctx = await createTestContext()
    const res = await ctx.app.request(
      'http://localhost:3000/api/admin/schema/export',
      {
        headers: {
          'X-Admin-Token':
            'test-admin-token-at-least-32-characters-long',
        },
      },
    )
    expect(res.status).toBe(200)
    const body = await json<{
      data: { version: number; collections: unknown[] }
    }>(res)
    expect(body.data.version).toBe(1)
    expect(Array.isArray(body.data.collections)).toBe(true)
  })
})
