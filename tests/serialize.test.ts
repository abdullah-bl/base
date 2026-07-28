import { describe, test, expect } from 'bun:test'
import {
  serializeFieldValue,
  deserializeRow,
  SerializationError,
} from '../src/collections/serialize'
import type { CollectionSchema } from '../src/schema/types'

const collection: CollectionSchema = {
  name: 'items',
  fields: {
    flag: { type: 'boolean', required: false, optional: true, unique: false },
    when: { type: 'date', required: false, optional: true, unique: false },
    meta: { type: 'json', required: false, optional: true, unique: false },
    embedding: {
      type: 'vector',
      required: false,
      optional: true,
      unique: false,
      vectorSize: 3,
    },
  },
  indexes: [],
}

describe('serialize / deserialize', () => {
  test('boolean round trip', () => {
    expect(serializeFieldValue(collection.fields.flag, true)).toBe(1)
    expect(serializeFieldValue(collection.fields.flag, false)).toBe(0)
    const row = deserializeRow({ flag: 1 }, collection)
    expect(row.flag).toBe(true)
  })

  test('date round trip', () => {
    const d = new Date('2020-01-01T00:00:00.000Z')
    const stored = serializeFieldValue(collection.fields.when, d)
    expect(stored).toBe(d.getTime())
    const row = deserializeRow({ when: stored }, collection)
    expect((row.when as Date).getTime()).toBe(d.getTime())
  })

  test('json round trip', () => {
    const stored = serializeFieldValue(collection.fields.meta, { a: 1 })
    expect(stored).toBe('{"a":1}')
    const row = deserializeRow({ meta: stored }, collection)
    expect(row.meta).toEqual({ a: 1 })
  })

  test('vector dimension enforcement', () => {
    expect(() =>
      serializeFieldValue(collection.fields.embedding, [1, 2], 'embedding'),
    ).toThrow(SerializationError)
    const stored = serializeFieldValue(
      collection.fields.embedding,
      [1, 2, 3],
      'embedding',
    )
    expect(stored).toBe('[1,2,3]')
  })

  test('malformed json throws', () => {
    expect(() =>
      deserializeRow({ meta: '{not-json' }, collection),
    ).toThrow(SerializationError)
  })
})
