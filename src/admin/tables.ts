import { getRegisteredCollections } from '../schema/registry.js'

const SYSTEM_TABLES = [
  'user',
  'session',
  'account',
  'verification',
  'files',
  '_base_schema',
  '_base_migrations',
  '_base_logs',
  '_base_audit',
  '_base_api_keys',
  '_base_webhooks',
  '_base_settings',
  '_base_collections',
  '_base_restart_jobs',
  '_base_onboarding',
] as const

const IDENT = /^[a-zA-Z_][a-zA-Z0-9_]*$/

export function getAllowedTables(): string[] {
  const collections = getRegisteredCollections()
    .map((c) => c.name)
    .filter((n) => n !== 'users')
  return Array.from(new Set([...SYSTEM_TABLES, ...collections])).sort()
}

export function assertAllowedTable(table: string): string {
  if (!IDENT.test(table)) {
    throw Object.assign(new Error('Invalid table name'), {
      status: 400,
      code: 'VALIDATION_ERROR',
    })
  }
  const allowed = getAllowedTables()
  if (!allowed.includes(table)) {
    throw Object.assign(new Error(`Table not allowed: ${table}`), {
      status: 403,
      code: 'FORBIDDEN',
    })
  }
  return table
}

export function assertIdent(name: string, label = 'identifier'): string {
  if (!IDENT.test(name)) {
    throw Object.assign(new Error(`Invalid ${label}`), {
      status: 400,
      code: 'VALIDATION_ERROR',
    })
  }
  return name
}
