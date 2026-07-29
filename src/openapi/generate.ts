import { getRegisteredCollections } from '../schema/registry.js'
import type { CollectionSchema, FieldSchema } from '../schema/types.js'
import { VERSION } from '../version.js'

function fieldToSchema(field: FieldSchema): Record<string, unknown> {
  switch (field.type) {
    case 'string':
    case 'text':
    case 'reference':
      return {
        type: 'string',
        ...(field.max ? { maxLength: field.max } : {}),
        ...(field.min ? { minLength: field.min } : {}),
      }
    case 'integer':
      return {
        type: 'integer',
        ...(field.min !== undefined ? { minimum: field.min } : {}),
        ...(field.max !== undefined ? { maximum: field.max } : {}),
      }
    case 'real':
      return { type: 'number' }
    case 'boolean':
      return { type: 'boolean' }
    case 'date':
      return { type: 'string', format: 'date-time' }
    case 'json':
      return {}
    case 'vector':
      return {
        type: 'array',
        items: { type: 'number' },
        ...(field.vectorSize ? { minItems: field.vectorSize, maxItems: field.vectorSize } : {}),
      }
    default:
      return {}
  }
}

function collectionSchemas(collection: CollectionSchema) {
  const properties: Record<string, unknown> = {
    id: { type: 'string' },
    createdAt: { type: 'integer' },
    updatedAt: { type: 'integer' },
    deletedAt: { type: 'integer', nullable: true },
  }
  const required: string[] = ['id', 'createdAt', 'updatedAt']
  const createProps: Record<string, unknown> = {}
  const createRequired: string[] = []

  for (const [name, field] of Object.entries(collection.fields)) {
    const schema = fieldToSchema(field)
    properties[name] = schema
    createProps[name] = schema
    if (field.required) {
      const isOwner =
        collection.access?.create === 'owner' &&
        collection.access.ownerField === name
      if (!isOwner) createRequired.push(name)
    }
  }

  return {
    Record: {
      type: 'object',
      properties,
      required,
    },
    Create: {
      type: 'object',
      properties: createProps,
      required: createRequired,
      additionalProperties: false,
    },
    Update: {
      type: 'object',
      properties: createProps,
      additionalProperties: false,
    },
  }
}

export function generateOpenApiSpec(baseUrl = 'http://localhost:3000') {
  const collections = getRegisteredCollections().filter(
    (c) => c.name !== 'user' && c.name !== 'users',
  )

  const paths: Record<string, unknown> = {
    '/api/health': {
      get: {
        summary: 'Health check',
        tags: ['system'],
        responses: { '200': { description: 'OK' } },
      },
    },
    '/api/health/live': {
      get: {
        summary: 'Liveness probe',
        tags: ['system'],
        responses: { '200': { description: 'Alive' } },
      },
    },
    '/api/health/ready': {
      get: {
        summary: 'Readiness probe',
        tags: ['system'],
        responses: {
          '200': { description: 'Ready' },
          '503': { description: 'Not ready' },
        },
      },
    },
  }

  const components: Record<string, unknown> = {
    schemas: {},
    securitySchemes: {
      cookieAuth: {
        type: 'apiKey',
        in: 'cookie',
        name: 'better-auth.session_token',
      },
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        description: 'API key (base_...)',
      },
    },
  }

  for (const collection of collections) {
    const schemas = collectionSchemas(collection)
    ;(components.schemas as Record<string, unknown>)[
      `${collection.name}Record`
    ] = schemas.Record
    ;(components.schemas as Record<string, unknown>)[
      `${collection.name}Create`
    ] = schemas.Create
    ;(components.schemas as Record<string, unknown>)[
      `${collection.name}Update`
    ] = schemas.Update

    const base = `/api/collections/${collection.name}`
    paths[base] = {
      get: {
        summary: `List ${collection.name}`,
        tags: [collection.name],
        parameters: [
          {
            name: 'filter',
            in: 'query',
            schema: { type: 'string' },
            description: 'JSON filter object; supports field__op suffixes',
          },
          { name: 'sort', in: 'query', schema: { type: 'string' } },
          { name: 'page', in: 'query', schema: { type: 'integer' } },
          { name: 'perPage', in: 'query', schema: { type: 'integer' } },
          { name: 'search', in: 'query', schema: { type: 'string' } },
          {
            name: 'join',
            in: 'query',
            schema: { type: 'string' },
            description:
              'Comma-separated relations to embed in each record (e.g. author,comments or authorId). Nested: comments.author. Alias: writer:authorId. FK scalars are kept; related objects/arrays are merged into data.',
          },
        ],
        responses: { '200': { description: 'List result' } },
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
      },
      post: {
        summary: `Create ${collection.name}`,
        tags: [collection.name],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: `#/components/schemas/${collection.name}Create` },
            },
          },
        },
        responses: { '201': { description: 'Created' } },
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
      },
    }
    paths[`${base}/{id}`] = {
      get: {
        summary: `Get ${collection.name}`,
        tags: [collection.name],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          {
            name: 'join',
            in: 'query',
            schema: { type: 'string' },
            description:
              'Comma-separated relations embedded into data (same semantics as list ?join=)',
          },
        ],
        responses: {
          '200': { description: 'Record' },
          '404': { description: 'Not found' },
        },
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
      },
      patch: {
        summary: `Update ${collection.name}`,
        tags: [collection.name],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: `#/components/schemas/${collection.name}Update` },
            },
          },
        },
        responses: { '200': { description: 'Updated' } },
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
      },
      delete: {
        summary: `Delete ${collection.name}`,
        tags: [collection.name],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'hard', in: 'query', schema: { type: 'boolean' } },
        ],
        responses: { '200': { description: 'Deleted' } },
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
      },
    }
  }

  return {
    openapi: '3.0.3',
    info: {
      title: 'Base BaaS API',
      version: VERSION,
      description:
        'Schema-driven REST API generated from registered collections.',
    },
    servers: [{ url: baseUrl }],
    paths,
    components,
  }
}
