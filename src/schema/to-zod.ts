import { z } from 'zod'
import type { CollectionSchema, FieldSchema } from './types.js'

/**
 * Convert a collection schema to Zod validators.
 * System fields (id, createdAt, updatedAt, deletedAt) are NOT included —
 * they are auto-managed by the CRUD layer.
 */
export function schemaToZod(collection: CollectionSchema): {
  create: z.ZodObject<any>
  update: z.ZodObject<any>
} {
  const createShape: Record<string, z.ZodTypeAny> = {}
  const updateShape: Record<string, z.ZodTypeAny> = {}

  for (const [fieldName, field] of Object.entries(collection.fields)) {
    const zodField = buildZodField(fieldName, field)

    // Create schema: required fields required, optional fields optional
    if (field.required) {
      createShape[fieldName] = zodField
    } else {
      createShape[fieldName] = zodField.optional().nullable()
    }

    // Update schema: ALL fields optional
    updateShape[fieldName] = zodField.optional().nullable()
  }

  const createSchema = z.object(createShape).strict()
  const updateSchema = z.object(updateShape).strict()

  return { create: createSchema, update: updateSchema }
}

function buildZodField(fieldName: string, field: FieldSchema): z.ZodTypeAny {
  let zodType: z.ZodTypeAny

  switch (field.type) {
    case 'string':
    case 'text':
      zodType = z.string()
      break
    case 'integer':
      zodType = z.number().int()
      break
    case 'real':
      zodType = z.number()
      break
    case 'boolean':
      zodType = z.boolean()
      break
    case 'date':
      zodType = z.coerce.date()
      break
    case 'json':
      zodType = z.any()
      break
    case 'reference':
      zodType = z.string()
      break
    case 'vector':
      zodType = z.array(z.number())
      break
    default:
      throw new Error(`Unknown field type: ${field.type}`)
  }

  if (field.max !== undefined && (field.type === 'string' || field.type === 'text')) {
    zodType = z.string().max(field.max)
  }

  if (field.min !== undefined && (field.type === 'string' || field.type === 'text')) {
    zodType = (zodType as z.ZodString).min(field.min)
  }

  return zodType
}
