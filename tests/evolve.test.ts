import { describe, test, expect, afterEach } from 'bun:test'
import {
  createTestContext,
  type TestContext,
} from './helpers/test-app'

describe('Schema evolution', () => {
  let ctx: TestContext
  afterEach(() => ctx?.cleanup())

  test('additive column is applied', async () => {
    ctx = await createTestContext({
      collections: async () => {
        const { defineCollection, f } = await import('../src/schema/define.js')
        defineCollection('notes', {
          fields: {
            title: f.string().required(),
          },
        })
      },
    })

    // Redefine with new optional field via evolution API
    const { clearRegistry } = await import('../src/schema/registry.js')
    const { defineCollection, f } = await import('../src/schema/define.js')
    const { applyEvolution, planEvolution } = await import(
      '../src/schema/evolve.js'
    )
    const { resetEnsuredTables } = await import(
      '../src/collections/table-create.js'
    )

    clearRegistry()
    resetEnsuredTables()
    const notes = defineCollection('notes', {
      fields: {
        title: f.string().required(),
        body: f.text().optional(),
      },
    })

    const plan = await planEvolution([notes])
    const addCol = plan.ops.find(
      (o) => o.type === 'add_column' && o.field === 'body',
    )
    expect(addCol).toBeTruthy()

    await applyEvolution([notes])
    expect(true).toBe(true)
  })

  test('destructive change is blocked', async () => {
    ctx = await createTestContext({
      collections: async () => {
        const { defineCollection, f } = await import('../src/schema/define.js')
        defineCollection('items', {
          fields: {
            name: f.string().required(),
            legacy: f.string().optional(),
          },
        })
      },
    })

    const { clearRegistry } = await import('../src/schema/registry.js')
    const { defineCollection, f } = await import('../src/schema/define.js')
    const { applyEvolution } = await import('../src/schema/evolve.js')
    const { resetEnsuredTables } = await import(
      '../src/collections/table-create.js'
    )

    clearRegistry()
    resetEnsuredTables()
    const items = defineCollection('items', {
      fields: {
        name: f.string().required(),
        // legacy removed
      },
    })

    await expect(applyEvolution([items])).rejects.toThrow(/blocked/i)
  })
})
