import { ulid } from 'ulid'
import { getClient } from '../db/client.js'
import {
  decryptSecret,
  encryptSecret,
  isEncryptedEnvelope,
} from './crypto.js'
import { getSettingDef, SETTING_DEFS, type SettingDef } from './defs.js'

export interface StoredSetting {
  key: string
  value: unknown
  encrypted: boolean
  updatedAt: number
  updatedBy: string | null
}

function serializeValue(def: SettingDef, value: unknown): {
  valueJson: string
  encrypted: number
} {
  if (def.secret && typeof value === 'string' && value.length > 0) {
    return {
      valueJson: encryptSecret(value),
      encrypted: 1,
    }
  }
  return {
    valueJson: JSON.stringify(value),
    encrypted: 0,
  }
}

function deserializeValue(
  def: SettingDef | undefined,
  valueJson: string,
  encrypted: boolean,
): unknown {
  if (encrypted || isEncryptedEnvelope(valueJson)) {
    return decryptSecret(valueJson)
  }
  try {
    return JSON.parse(valueJson)
  } catch {
    // Legacy plain string
    return valueJson
  }
}

export async function getStoredSetting(
  key: string,
): Promise<StoredSetting | null> {
  const client = getClient()
  const result = await client.execute({
    sql: `SELECT * FROM "_base_settings" WHERE "key" = ? LIMIT 1`,
    args: [key],
  })
  const row = result.rows?.[0] as Record<string, unknown> | undefined
  if (!row) return null
  const def = getSettingDef(key)
  const encrypted = Boolean(row.encrypted)
  return {
    key,
    value: deserializeValue(def, String(row.value), encrypted),
    encrypted,
    updatedAt: Number(row.updatedAt),
    updatedBy: row.updatedBy ? String(row.updatedBy) : null,
  }
}

export async function listStoredSettings(): Promise<StoredSetting[]> {
  const client = getClient()
  const result = await client.execute(
    `SELECT * FROM "_base_settings" ORDER BY "key" ASC`,
  )
  const out: StoredSetting[] = []
  for (const row of result.rows || []) {
    const r = row as Record<string, unknown>
    const key = String(r.key)
    const def = getSettingDef(key)
    const encrypted = Boolean(r.encrypted)
    try {
      out.push({
        key,
        value: deserializeValue(def, String(r.value), encrypted),
        encrypted,
        updatedAt: Number(r.updatedAt),
        updatedBy: r.updatedBy ? String(r.updatedBy) : null,
      })
    } catch (err) {
      console.warn(
        `⚠️  Failed to decrypt/parse setting "${key}":`,
        err instanceof Error ? err.message : err,
      )
    }
  }
  return out
}

export async function upsertSetting(
  key: string,
  value: unknown,
  updatedBy?: string | null,
): Promise<StoredSetting> {
  const def = getSettingDef(key)
  if (!def) {
    throw Object.assign(new Error(`Unknown setting key: ${key}`), {
      status: 400,
      code: 'VALIDATION_ERROR',
    })
  }
  if (def.bootstrapOnly) {
    throw Object.assign(
      new Error(`Setting "${key}" is bootstrap-only and cannot be changed`),
      { status: 400, code: 'VALIDATION_ERROR' },
    )
  }

  const parsed = def.schema.safeParse(value)
  if (!parsed.success) {
    throw Object.assign(
      new Error(
        `Invalid value for "${key}": ${parsed.error.issues.map((i) => i.message).join(', ')}`,
      ),
      { status: 400, code: 'VALIDATION_ERROR', details: parsed.error.issues },
    )
  }

  // Blank secret keeps existing
  if (
    def.secret &&
    typeof parsed.data === 'string' &&
    parsed.data.length === 0
  ) {
    const existing = await getStoredSetting(key)
    if (existing) return existing
  }

  const { valueJson, encrypted } = serializeValue(def, parsed.data)
  const now = Date.now()
  const client = getClient()
  await client.execute({
    sql: `INSERT INTO "_base_settings" ("key", "value", "encrypted", "updatedAt", "updatedBy")
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT("key") DO UPDATE SET
            "value" = excluded."value",
            "encrypted" = excluded."encrypted",
            "updatedAt" = excluded."updatedAt",
            "updatedBy" = excluded."updatedBy"`,
    args: [key, valueJson, encrypted, now, updatedBy ?? null],
  })

  return {
    key,
    value: parsed.data,
    encrypted: encrypted === 1,
    updatedAt: now,
    updatedBy: updatedBy ?? null,
  }
}

export async function seedSettingsFromEnv(
  envSnapshot: Record<string, unknown>,
  mapping: Record<string, string>,
): Promise<number> {
  let seeded = 0
  for (const [envKey, settingKey] of Object.entries(mapping)) {
    const existing = await getStoredSetting(settingKey)
    if (existing) continue
    const def = getSettingDef(settingKey)
    if (!def) continue
    const raw = envSnapshot[envKey]
    if (raw === undefined || raw === null || raw === '') continue

    let value: unknown = raw
    if (def.schema instanceof Object) {
      // Coerce booleans/numbers already typed from env loader
      value = raw
    }
    try {
      await upsertSetting(settingKey, value, 'env-seed')
      seeded++
    } catch {
      // ignore seed failures for incompatible values
    }
  }

  // Ensure every def has a row with default if missing (optional — skip to keep table sparse)
  return seeded
}

export async function ensureDefaultSettings(): Promise<void> {
  for (const def of SETTING_DEFS) {
    if (def.bootstrapOnly) continue
    const existing = await getStoredSetting(def.key)
    if (!existing) {
      await upsertSetting(def.key, def.default, 'system')
    }
  }
}

/** Restart job helpers */
export type RestartJobStatus =
  | 'pending'
  | 'validating'
  | 'draining'
  | 'restarting'
  | 'health_check'
  | 'completed'
  | 'rolled_back'
  | 'failed'

export interface RestartJob {
  id: string
  status: RestartJobStatus
  reason: string | null
  actorId: string | null
  actorKind: string | null
  error: string | null
  createdAt: number
  updatedAt: number
  finishedAt: number | null
}

export async function createRestartJob(opts: {
  reason?: string
  actorId?: string | null
  actorKind?: string | null
}): Promise<RestartJob> {
  const client = getClient()
  const active = await client.execute(
    `SELECT id FROM "_base_restart_jobs"
     WHERE "status" IN ('pending','validating','draining','restarting','health_check')
     LIMIT 1`,
  )
  if (active.rows?.length) {
    throw Object.assign(new Error('A restart is already in progress'), {
      status: 409,
      code: 'RESTART_IN_PROGRESS',
    })
  }

  const id = ulid()
  const now = Date.now()
  await client.execute({
    sql: `INSERT INTO "_base_restart_jobs"
      ("id","status","reason","actorId","actorKind","error","createdAt","updatedAt","finishedAt")
      VALUES (?,?,?,?,?,NULL,?,?,NULL)`,
    args: [
      id,
      'pending',
      opts.reason ?? null,
      opts.actorId ?? null,
      opts.actorKind ?? null,
      now,
      now,
    ],
  })
  return {
    id,
    status: 'pending',
    reason: opts.reason ?? null,
    actorId: opts.actorId ?? null,
    actorKind: opts.actorKind ?? null,
    error: null,
    createdAt: now,
    updatedAt: now,
    finishedAt: null,
  }
}

export async function updateRestartJob(
  id: string,
  patch: Partial<Pick<RestartJob, 'status' | 'error' | 'finishedAt'>>,
): Promise<RestartJob | null> {
  const client = getClient()
  const now = Date.now()
  const current = await getRestartJob(id)
  if (!current) return null

  const status = patch.status ?? current.status
  const error = patch.error !== undefined ? patch.error : current.error
  const finishedAt =
    patch.finishedAt !== undefined ? patch.finishedAt : current.finishedAt

  await client.execute({
    sql: `UPDATE "_base_restart_jobs"
          SET "status"=?, "error"=?, "updatedAt"=?, "finishedAt"=?
          WHERE "id"=?`,
    args: [status, error, now, finishedAt, id],
  })
  return getRestartJob(id)
}

export async function getRestartJob(id: string): Promise<RestartJob | null> {
  const client = getClient()
  const result = await client.execute({
    sql: `SELECT * FROM "_base_restart_jobs" WHERE "id" = ? LIMIT 1`,
    args: [id],
  })
  const row = result.rows?.[0] as Record<string, unknown> | undefined
  if (!row) return null
  return rowToRestart(row)
}

export async function getLatestRestartJob(): Promise<RestartJob | null> {
  const client = getClient()
  const result = await client.execute(
    `SELECT * FROM "_base_restart_jobs" ORDER BY "createdAt" DESC LIMIT 1`,
  )
  const row = result.rows?.[0] as Record<string, unknown> | undefined
  if (!row) return null
  return rowToRestart(row)
}

function rowToRestart(row: Record<string, unknown>): RestartJob {
  return {
    id: String(row.id),
    status: String(row.status) as RestartJobStatus,
    reason: row.reason ? String(row.reason) : null,
    actorId: row.actorId ? String(row.actorId) : null,
    actorKind: row.actorKind ? String(row.actorKind) : null,
    error: row.error ? String(row.error) : null,
    createdAt: Number(row.createdAt),
    updatedAt: Number(row.updatedAt),
    finishedAt: row.finishedAt != null ? Number(row.finishedAt) : null,
  }
}
