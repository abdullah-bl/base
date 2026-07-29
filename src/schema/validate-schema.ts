import { z } from 'zod'
import type { CollectionSchema } from './types.js'

const fieldSchema = z.object({
  type: z.enum([
    'string',
    'text',
    'integer',
    'real',
    'boolean',
    'date',
    'json',
    'reference',
    'vector',
  ]),
  required: z.boolean().default(false),
  optional: z.boolean().default(true),
  unique: z.boolean().default(false),
  default: z.unknown().optional(),
  max: z.number().optional(),
  min: z.number().optional(),
  ref: z.string().optional(),
  vectorSize: z.number().int().positive().optional(),
})

const accessSchema = z
  .object({
    create: z.enum(['public', 'authenticated', 'owner']).optional(),
    read: z.enum(['public', 'authenticated', 'owner']).optional(),
    update: z.enum(['public', 'authenticated', 'owner']).optional(),
    delete: z.enum(['public', 'authenticated', 'owner']).optional(),
    ownerField: z.string().optional(),
  })
  .optional()

export const collectionSchemaZod = z.object({
  name: z
    .string()
    .regex(
      /^[a-zA-Z_][a-zA-Z0-9_]*$/,
      'Collection name must start with letter/underscore',
    ),
  fields: z.record(z.string(), fieldSchema),
  indexes: z
    .array(
      z.object({
        fields: z.array(z.string()).min(1),
        name: z.string().optional(),
        unique: z.boolean().optional(),
      }),
    )
    .default([]),
  access: accessSchema,
})

export function parseCollectionSchema(input: unknown): CollectionSchema {
  const parsed = collectionSchemaZod.parse(input)
  // Normalize required/optional consistency
  const fields: CollectionSchema['fields'] = {}
  for (const [name, field] of Object.entries(parsed.fields)) {
    const required = Boolean(field.required)
    fields[name] = {
      ...field,
      required,
      optional: !required,
    }
    if (field.type === 'reference' && !field.ref) {
      throw new Error(`Reference field "${name}" missing ref`)
    }
    if (field.type === 'vector' && !field.vectorSize) {
      throw new Error(`Vector field "${name}" missing vectorSize`)
    }
  }

  if (parsed.access) {
    const levels = [
      parsed.access.create,
      parsed.access.read,
      parsed.access.update,
      parsed.access.delete,
    ]
    if (levels.some((l) => l === 'owner') && !parsed.access.ownerField) {
      throw new Error(
        `Collection "${parsed.name}" uses owner access but ownerField is missing`,
      )
    }
  }

  return {
    name: parsed.name,
    fields,
    indexes: parsed.indexes || [],
    access: parsed.access,
  }
}

export function safeParseCollectionSchema(input: unknown): {
  success: boolean
  data?: CollectionSchema
  error?: string
} {
  try {
    return { success: true, data: parseCollectionSchema(input) }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}
