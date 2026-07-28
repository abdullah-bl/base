import type { CollectionSchema, FieldSchema } from '../schema/types.js'

export class SerializationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SerializationError'
  }
}

/**
 * Serialize a field value for SQL binding.
 */
export function serializeFieldValue(
  field: FieldSchema,
  value: unknown,
  fieldName?: string,
): unknown {
  if (value === null || value === undefined) {
    return null
  }

  switch (field.type) {
    case 'boolean':
      return value ? 1 : 0
    case 'date': {
      if (value instanceof Date) return value.getTime()
      if (typeof value === 'number') return value
      if (typeof value === 'string') {
        const parsed = Date.parse(value)
        if (Number.isNaN(parsed)) {
          throw new SerializationError(
            `Invalid date value for field "${fieldName ?? 'unknown'}"`,
          )
        }
        return parsed
      }
      return value
    }
    case 'json':
      return typeof value === 'string' ? value : JSON.stringify(value)
    case 'vector': {
      if (!Array.isArray(value)) {
        throw new SerializationError(
          `Vector field "${fieldName ?? 'unknown'}" must be an array of numbers`,
        )
      }
      if (
        field.vectorSize !== undefined &&
        value.length !== field.vectorSize
      ) {
        throw new SerializationError(
          `Vector field "${fieldName ?? 'unknown'}" expects ${field.vectorSize} dimensions, got ${value.length}`,
        )
      }
      return JSON.stringify(value)
    }
    default:
      return value
  }
}

/**
 * Deserialize a row from SQLite into JS-native types.
 */
export function deserializeRow(
  row: Record<string, unknown>,
  collection: CollectionSchema,
): Record<string, unknown> {
  const result: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(row)) {
    const field = collection.fields[key]

    if (field) {
      result[key] = deserializeFieldValue(field, value, key)
    } else {
      result[key] = value
    }
  }

  return result
}

function deserializeFieldValue(
  field: FieldSchema,
  value: unknown,
  fieldName: string,
): unknown {
  if (value === null || value === undefined) {
    return value
  }

  switch (field.type) {
    case 'boolean':
      return value === 1 || value === true || value === '1'
    case 'date':
      return value ? new Date(value as number | string) : null
    case 'json':
    case 'vector': {
      if (typeof value !== 'string') return value
      try {
        return JSON.parse(value)
      } catch {
        throw new SerializationError(
          `Malformed ${field.type} data in field "${fieldName}"`,
        )
      }
    }
    default:
      return value
  }
}

/**
 * Serialize all user fields present in a data object for insert/update.
 */
export function serializeRecord(
  collection: CollectionSchema,
  data: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(data)) {
    const field = collection.fields[key]
    if (field) {
      out[key] = serializeFieldValue(field, value, key)
    } else {
      out[key] = value
    }
  }
  return out
}
