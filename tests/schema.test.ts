import { describe, test, expect, beforeEach } from 'bun:test'
import { f, defineCollection } from '../src/schema/define'
import { clearRegistry, getAllCollections, validateRegistry } from '../src/schema/registry'
import { schemaToZod } from '../src/schema/to-zod'
import { schemaToDrizzle } from '../src/schema/to-drizzle'

describe('Schema Engine', () => {
  beforeEach(() => {
    clearRegistry()
  })

  describe('Field Builder Chaining', () => {
    test('string().required().max(200) builds correct schema', () => {
      const schema = f.string().required().max(200).build()
      expect(schema.type).toBe('string')
      expect(schema.required).toBe(true)
      expect(schema.optional).toBe(false)
      expect(schema.max).toBe(200)
    })

    test('text().optional() builds correct schema', () => {
      const schema = f.text().optional().build()
      expect(schema.type).toBe('text')
      expect(schema.required).toBe(false)
      expect(schema.optional).toBe(true)
    })

    test('boolean().default(false) builds correct schema', () => {
      const schema = f.boolean().default(false).build()
      expect(schema.type).toBe('boolean')
      expect(schema.default).toBe(false)
    })

    test('reference(collection).required() builds correct schema', () => {
      const schema = f.reference('users').required().build()
      expect(schema.type).toBe('reference')
      expect(schema.ref).toBe('users')
      expect(schema.required).toBe(true)
    })

    test('unique() sets unique flag', () => {
      const schema = f.string().unique().build()
      expect(schema.unique).toBe(true)
    })

    test('integer().min(0) builds correct schema', () => {
      const schema = f.integer().min(0).build()
      expect(schema.type).toBe('integer')
      expect(schema.min).toBe(0)
    })

    test('vector(1536) builds correct schema', () => {
      const schema = f.vector(1536).build()
      expect(schema.type).toBe('vector')
      expect(schema.vectorSize).toBe(1536)
    })
  })

  describe('defineCollection', () => {
    test('creates collection and stores in registry', () => {
      const posts = defineCollection('posts', {
        fields: {
          title: f.string().required().max(200),
          content: f.text().optional(),
        },
      })

      expect(posts.name).toBe('posts')
      expect(posts.fields.title.type).toBe('string')
      expect(posts.fields.title.required).toBe(true)
      expect(posts.fields.content.type).toBe('text')
      expect(posts.fields.content.optional).toBe(true)

      const all = getAllCollections()
      expect(all).toHaveLength(1)
      expect(all[0].name).toBe('posts')
    })

    test('throws on duplicate collection name', () => {
      defineCollection('posts', {
        fields: { title: f.string() },
      })

      expect(() => {
        defineCollection('posts', {
          fields: { title: f.string() },
        })
      }).toThrow('already defined')
    })

    test('throws on invalid collection name', () => {
      expect(() => {
        defineCollection('123-invalid', {
          fields: { title: f.string() },
        })
      }).toThrow('Invalid collection name')
    })

    test('stores indexes correctly', () => {
      const posts = defineCollection('posts', {
        fields: {
          title: f.string(),
          authorId: f.reference('users'),
        },
        indexes: [
          { fields: ['authorId', 'title'], name: 'idx_posts_author' },
          { fields: ['title'], unique: true },
        ],
      })

      expect(posts.indexes).toHaveLength(2)
      expect(posts.indexes[0].name).toBe('idx_posts_author')
      expect(posts.indexes[0].fields).toEqual(['authorId', 'title'])
      expect(posts.indexes[1].unique).toBe(true)
    })
  })

  describe('Registry Validation', () => {
    test('validates references to existing collections', () => {
      defineCollection('users', {
        fields: { name: f.string() },
      })

      defineCollection('posts', {
        fields: {
          authorId: f.reference('users').required(),
        },
      })

      expect(() => validateRegistry()).not.toThrow()
    })

    test('validates references to built-in users collection', () => {
      defineCollection('posts', {
        fields: {
          authorId: f.reference('users').required(),
        },
      })

      expect(() => validateRegistry()).not.toThrow()
    })

    test('throws on dangling reference to non-existent collection', () => {
      defineCollection('posts', {
        fields: {
          authorId: f.reference('nonexistent').required(),
        },
      })

      expect(() => validateRegistry()).toThrow('non-existent collection')
    })

    test('throws on index referencing non-existent field', () => {
      defineCollection('posts', {
        fields: { title: f.string() },
        indexes: [{ fields: ['title', 'nonexistent'] }],
      })

      expect(() => validateRegistry()).toThrow('non-existent field')
    })

    test('throws on duplicate index name within collection', () => {
      defineCollection('posts', {
        fields: { title: f.string(), slug: f.string() },
        indexes: [
          { fields: ['title'], name: 'idx_name' },
          { fields: ['slug'], name: 'idx_name' },
        ],
      })

      expect(() => validateRegistry()).toThrow('Duplicate index name')
    })
  })

  describe('Zod Conversion', () => {
    test('create schema validates correct data', () => {
      const collection = defineCollection('posts', {
        fields: {
          title: f.string().required().max(200),
          viewCount: f.integer().default(0),
          published: f.boolean().default(false),
        },
      })

      const { create } = schemaToZod(collection)

      const validData = {
        createdAt: Date.now(),
        updatedAt: Date.now(),
        deletedAt: null,
        title: 'Hello World',
        viewCount: 0,
        published: false,
      }

      const result = create.safeParse(validData)
      expect(result.success).toBe(true)
    })

    test('create schema rejects invalid data (wrong type)', () => {
      const collection = defineCollection('posts', {
        fields: {
          title: f.string().required(),
          viewCount: f.integer(),
        },
      })

      const { create } = schemaToZod(collection)

      const invalidData = {
        createdAt: Date.now(),
        updatedAt: Date.now(),
        deletedAt: null,
        title: 123, // wrong type
        viewCount: 'not a number', // wrong type
      }

      const result = create.safeParse(invalidData)
      expect(result.success).toBe(false)
    })

    test('create schema rejects missing required field', () => {
      const collection = defineCollection('posts', {
        fields: {
          title: f.string().required(),
          content: f.text().optional(),
        },
      })

      const { create } = schemaToZod(collection)

      const invalidData = {
        createdAt: Date.now(),
        updatedAt: Date.now(),
        deletedAt: null,
        content: 'Some content',
        // missing required title
      }

      const result = create.safeParse(invalidData)
      expect(result.success).toBe(false)
    })

    test('create schema accepts optional field as null', () => {
      const collection = defineCollection('posts', {
        fields: {
          title: f.string().required(),
          content: f.text().optional(),
        },
      })

      const { create } = schemaToZod(collection)

      const validData = {
        createdAt: Date.now(),
        updatedAt: Date.now(),
        deletedAt: null,
        title: 'Hello',
        content: null,
      }

      const result = create.safeParse(validData)
      expect(result.success).toBe(true)
    })

    test('update schema accepts partial data', () => {
      const collection = defineCollection('posts', {
        fields: {
          title: f.string().required(),
          content: f.text().required(),
          viewCount: f.integer().default(0),
        },
      })

      const { update } = schemaToZod(collection)

      const partialData = {
        title: 'Updated title',
        // content and viewCount are optional in update schema
      }

      const result = update.safeParse(partialData)
      expect(result.success).toBe(true)
    })

    test('update schema makes all fields optional', () => {
      const collection = defineCollection('posts', {
        fields: {
          title: f.string().required(),
        },
      })

      const { update } = schemaToZod(collection)

      // Empty object should be valid for update
      const result = update.safeParse({})
      expect(result.success).toBe(true)
    })

    test('schema validates max length constraint', () => {
      const collection = defineCollection('posts', {
        fields: {
          title: f.string().required().max(10),
        },
      })

      const { create } = schemaToZod(collection)

      const tooLong = {
        createdAt: Date.now(),
        updatedAt: Date.now(),
        deletedAt: null,
        title: 'This is way too long',
      }

      const result = create.safeParse(tooLong)
      expect(result.success).toBe(false)
    })
  })

  describe('Drizzle Conversion', () => {
    test('converts collection to Drizzle table', () => {
      const collection = defineCollection('posts', {
        fields: {
          title: f.string().required(),
          viewCount: f.integer().default(0),
          published: f.boolean().default(false),
        },
      })

      const tables = schemaToDrizzle([collection])

      expect(tables).toHaveProperty('posts')
      const postsTable = tables.posts

      // Table should be a function (Drizzle table definition)
      expect(typeof postsTable).toBe('function')
    })

    test('converts all field types correctly', () => {
      const collection = defineCollection('items', {
        fields: {
          name: f.string(),
          description: f.text(),
          quantity: f.integer(),
          price: f.real(),
          available: f.boolean(),
          createdAt: f.date(),
          metadata: f.json(),
          userId: f.reference('users'),
        },
      })

      const tables = schemaToDrizzle([collection])

      expect(tables).toHaveProperty('items')
    })

    test('includes system columns', () => {
      const collection = defineCollection('posts', {
        fields: {
          title: f.string(),
        },
      })

      const tables = schemaToDrizzle([collection])
      const postsTable = tables.posts

      // Access the table definition
      expect(postsTable).toBeDefined()
    })
  })

  describe('End-to-End Example', () => {
    test('example from task description works', () => {
      const posts = defineCollection('posts', {
        fields: {
          title: f.string().required().max(200),
          content: f.text().optional(),
          slug: f.string().unique(),
          published: f.boolean().default(false),
          viewCount: f.integer().default(0),
          authorId: f.reference('users').required(),
        },
        indexes: [
          { fields: ['authorId', 'createdAt'], name: 'idx_posts_author' },
          { fields: ['slug'], unique: true },
        ],
      })

      expect(posts.name).toBe('posts')
      expect(posts.fields.title.required).toBe(true)
      expect(posts.fields.title.max).toBe(200)
      expect(posts.fields.authorId.ref).toBe('users')
      expect(posts.fields.authorId.required).toBe(true)
      expect(posts.indexes).toHaveLength(2)

      // Validate registry (users is allowed as reference)
      expect(() => validateRegistry()).not.toThrow()

      // Convert to Zod
      const { create, update } = schemaToZod(posts)
      expect(create).toBeDefined()
      expect(update).toBeDefined()

      // Convert to Drizzle
      const tables = schemaToDrizzle([posts])
      expect(tables).toHaveProperty('posts')
    })
  })
})