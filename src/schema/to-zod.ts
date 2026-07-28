import { z } from 'zod'
import type { CollectionSchema, FieldSchema } from './types.js'

/**
 * Convert a collection schema to Zod validators
 * @param collection - Collection schema
 * @returns Object with create and update Zod schemas
 */
export function schemaToZod(collection: CollectionSchema): {
  create: z.ZodObject<any>
  update: z.ZodObject<any>
} {
  const createShape: Record<string, z.ZodTypeAny> = {}
  const updateShape: Record<string, z.ZodTypeAny> = {}

  // Add system fields to create schema (id is auto-generated)
  createShape.createdAt = z.number()
  createShape.updatedAt = z.number()
  createShape.deletedAt = z.number().nullable()

  // Add system fields to update schema (all optional)
  updateShape.createdAt = z.number().optional()
  updateShape.updatedAt = z.number().optional()
  updateShape.deletedAt = z.number().nullable().optional()

  // Process each field
  for (const [fieldName, field] of Object.entries(collection.fields)) {
    const zodField = buildZodField(fieldName, field)

    // Create schema: required fields are required, optional fields are optional
    if (field.required) {
      createShape[fieldName] = zodField
    } else {
      createShape[fieldName] = zodField.optional().nullable()
    }

    // Update schema: ALL fields optional (for partial updates)
    updateShape[fieldName] = zodField.optional().nullable()
  }

  // Build create schema with strict mode (no unknown fields)
  const createSchema = z.object(createShape).strict()

  // Build update schema with partial mode (all optional) and strict mode
  const updateSchema = z.object(updateShape).strict()

  return { create: createSchema, update: updateSchema }
}

/**
 * Build a Zod validator for a single field
 * @param fieldName - Name of the field
 * @param field - Field schema
 * @returns Zod type
 */
function buildZodField(fieldName: string, field: FieldSchema): z.ZodTypeAny {
  let zodType: z.ZodTypeAny

  // Map field types to Zod types
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
      // Coerce to Date from string or number
      zodType = z.coerce.date()
      break

    case 'json':
      // Accept any JSON-compatible value
      zodType = z.any()
      break

    case 'reference':
      // References are ULID strings
      zodType = z.string()
      break

    case 'vector':
      // Vectors are arrays of numbers
      zodType = z.array(z.number())
      break

    default:
      throw new Error(`Unknown field type: ${field.type}`)
  }

  // Apply constraints using .refine for generic types
  if (field.max !== undefined && (field.type === 'string' || field.type === 'text')) {
    zodType = z.string().max(field.max)
  }

  if (field.min !== undefined && (field.type === 'string' || field.type === 'text')) {
    zodType = (zodType as z.ZodString).min(field.min)
  }

  // Note: default values are applied at the application/database layer,
  // not in the Zod schema. Zod validates incoming data.

  return zodType
}