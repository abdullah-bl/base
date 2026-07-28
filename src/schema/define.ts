import type {
  CollectionAccess,
  CollectionSchema,
  FieldSchema,
  FieldType,
} from './types.js'
import { registerCollection } from './registry.js'

/**
 * Field Builder Class
 * Implements method chaining for fluent field definition
 */
class FieldBuilder {
  private schema: Partial<FieldSchema> = {
    required: false,
    optional: true,
    unique: false,
  }

  constructor(type: FieldType) {
    this.schema.type = type
  }

  required(): this {
    this.schema.required = true
    this.schema.optional = false
    return this
  }

  optional(): this {
    this.schema.optional = true
    this.schema.required = false
    return this
  }

  default(value: unknown): this {
    this.schema.default = value
    return this
  }

  unique(): this {
    this.schema.unique = true
    return this
  }

  max(n: number): this {
    this.schema.max = n
    return this
  }

  min(n: number): this {
    this.schema.min = n
    return this
  }

  ref(collection: string): this {
    this.schema.ref = collection
    return this
  }

  vectorSize(dims: number): this {
    this.schema.vectorSize = dims
    return this
  }

  build(): FieldSchema {
    return {
      type: this.schema.type as FieldType,
      required: this.schema.required || false,
      optional: this.schema.optional !== false,
      unique: this.schema.unique || false,
      default: this.schema.default,
      max: this.schema.max,
      min: this.schema.min,
      ref: this.schema.ref,
      vectorSize: this.schema.vectorSize,
    }
  }
}

const f = {
  string(): FieldBuilder {
    return new FieldBuilder('string')
  },
  text(): FieldBuilder {
    return new FieldBuilder('text')
  },
  integer(): FieldBuilder {
    return new FieldBuilder('integer')
  },
  real(): FieldBuilder {
    return new FieldBuilder('real')
  },
  boolean(): FieldBuilder {
    return new FieldBuilder('boolean')
  },
  date(): FieldBuilder {
    return new FieldBuilder('date')
  },
  json(): FieldBuilder {
    return new FieldBuilder('json')
  },
  reference(targetCollection: string): FieldBuilder {
    return new FieldBuilder('reference').ref(targetCollection)
  },
  vector(dims: number): FieldBuilder {
    return new FieldBuilder('vector').vectorSize(dims)
  },
}

function defineCollection(
  name: string,
  config: {
    fields: Record<string, FieldBuilder | FieldSchema>
    indexes?: Array<{ fields: string[]; name?: string; unique?: boolean }>
    access?: CollectionAccess
  },
): CollectionSchema {
  if (!name || typeof name !== 'string') {
    throw new Error('Collection name must be a non-empty string')
  }
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    throw new Error(
      `Invalid collection name "${name}": must start with letter or underscore, contain only letters, numbers, and underscores`,
    )
  }

  const processedFields: Record<string, FieldSchema> = {}
  for (const [fieldName, fieldDef] of Object.entries(config.fields)) {
    if (fieldDef instanceof FieldBuilder) {
      processedFields[fieldName] = fieldDef.build()
    } else if (typeof fieldDef === 'object' && fieldDef.type) {
      processedFields[fieldName] = fieldDef
    } else {
      throw new Error(
        `Invalid field definition for "${fieldName}" in collection "${name}"`,
      )
    }
  }

  const collection: CollectionSchema = {
    name,
    fields: processedFields,
    indexes: config.indexes || [],
    access: config.access,
  }

  registerCollection(collection)

  return collection
}

export { defineCollection, f, FieldBuilder }
export type {
  FieldSchema,
  CollectionSchema,
  CollectionAccess,
} from './types.js'
