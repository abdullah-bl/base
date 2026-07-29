import env, { loadEnv, type Env } from '../env.js'
import {
  ENV_TO_SETTING,
  getSettingDef,
  SETTING_DEFS,
  type SettingApplyMode,
  type SettingDef,
  type SettingSource,
} from './defs.js'
import {
  ensureDefaultSettings,
  listStoredSettings,
  seedSettingsFromEnv,
  upsertSetting,
} from './store.js'

export interface ResolvedSetting {
  key: string
  value: unknown
  source: SettingSource
  secret: boolean
  applyMode: SettingApplyMode
  section: SettingDef['section']
  description: string
  dangerous?: boolean
  /** For secrets: whether a non-empty value is configured */
  configured?: boolean
  /** Redacted display value for API */
  displayValue: unknown
}

export interface EffectiveRuntime {
  appName: string
  publicUrl: string
  setupCompleted: boolean
  allowPublicSignup: boolean
  requireEmailVerification: boolean
  adminEmails: string
  corsOrigins: string
  hardDeleteEnabled: boolean
  rateLimitEnabled: boolean
  rateLimitWindowMs: number
  rateLimitMax: number
  rateLimitAuthMax: number
  realtimeEnabled: boolean
  realtimeReplayBuffer: number
  logLevel: Env['LOG_LEVEL']
  logPersist: boolean
  logBufferSize: number
  logRetentionDays: number
  backupRetention: number
  backupScheduleHours: number
  webhooksEnabled: boolean
  maxFileSize: number
  downloadMode: 'proxy' | 'redirect'
  email: {
    enabled: boolean
    host: string
    port: number
    secure: boolean
    user: string
    password: string
    from: string
    replyTo: string
    brandName: string
    brandColor: string
  }
  oauth: {
    github: { enabled: boolean; clientId: string; clientSecret: string }
    google: { enabled: boolean; clientId: string; clientSecret: string }
    discord: { enabled: boolean; clientId: string; clientSecret: string }
    microsoft: { enabled: boolean; clientId: string; clientSecret: string }
    apple: { enabled: boolean; clientId: string; clientSecret: string }
  }
}

let cache: Map<string, { value: unknown; source: SettingSource }> | null = null
let runtimeCache: EffectiveRuntime | null = null

function envDefaultFor(key: string, e: Env): unknown | undefined {
  for (const [envKey, settingKey] of Object.entries(ENV_TO_SETTING)) {
    if (settingKey === key) {
      return (e as Record<string, unknown>)[envKey]
    }
  }
  if (key === 'app.publicUrl') return e.BETTER_AUTH_URL
  return undefined
}

export async function initSettings(): Promise<void> {
  const e = loadEnv()
  await seedSettingsFromEnv(e as unknown as Record<string, unknown>, ENV_TO_SETTING)
  // Do not force-write every default — keep sparse; resolve fills defaults
  invalidateSettingsCache()
}

export function invalidateSettingsCache(): void {
  cache = null
  runtimeCache = null
}

async function loadCache(): Promise<
  Map<string, { value: unknown; source: SettingSource }>
> {
  if (cache) return cache
  const map = new Map<string, { value: unknown; source: SettingSource }>()
  const e = loadEnv()

  for (const def of SETTING_DEFS) {
    const fromEnv = envDefaultFor(def.key, e)
    if (fromEnv !== undefined) {
      map.set(def.key, { value: fromEnv, source: 'env' })
    } else {
      map.set(def.key, { value: def.default, source: 'default' })
    }
  }

  try {
    const stored = await listStoredSettings()
    for (const s of stored) {
      // DB wins over env defaults for operational keys
      map.set(s.key, { value: s.value, source: 'db' })
    }
  } catch {
    // DB may not be ready yet
  }

  cache = map
  return map
}

export async function getSettingValue<T = unknown>(key: string): Promise<T> {
  const map = await loadCache()
  const hit = map.get(key)
  if (hit) return hit.value as T
  const def = getSettingDef(key)
  return (def?.default as T) ?? (undefined as T)
}

export async function listResolvedSettings(): Promise<ResolvedSetting[]> {
  const map = await loadCache()
  return SETTING_DEFS.map((def) => {
    const hit = map.get(def.key) || {
      value: def.default,
      source: 'default' as SettingSource,
    }
    const secret = Boolean(def.secret)
    const configured =
      secret &&
      typeof hit.value === 'string' &&
      (hit.value as string).length > 0
    return {
      key: def.key,
      value: secret ? undefined : hit.value,
      source: hit.source,
      secret,
      applyMode: def.applyMode,
      section: def.section,
      description: def.description,
      dangerous: def.dangerous,
      configured: secret ? configured : undefined,
      displayValue: secret
        ? configured
          ? '[REDACTED]'
          : ''
        : hit.value,
    }
  })
}

export async function getEffectiveRuntime(): Promise<EffectiveRuntime> {
  if (runtimeCache) return runtimeCache
  const g = getSettingValue
  const runtime: EffectiveRuntime = {
    appName: await g<string>('app.name'),
    publicUrl: await g<string>('app.publicUrl'),
    setupCompleted: await g<boolean>('app.setupCompleted'),
    allowPublicSignup: await g<boolean>('auth.allowPublicSignup'),
    requireEmailVerification: await g<boolean>(
      'auth.requireEmailVerification',
    ),
    adminEmails: await g<string>('auth.adminEmails'),
    corsOrigins: await g<string>('cors.origins'),
    hardDeleteEnabled: await g<boolean>('security.hardDeleteEnabled'),
    rateLimitEnabled: await g<boolean>('rateLimit.enabled'),
    rateLimitWindowMs: await g<number>('rateLimit.windowMs'),
    rateLimitMax: await g<number>('rateLimit.max'),
    rateLimitAuthMax: await g<number>('rateLimit.authMax'),
    realtimeEnabled: await g<boolean>('realtime.enabled'),
    realtimeReplayBuffer: await g<number>('realtime.replayBuffer'),
    logLevel: await g<Env['LOG_LEVEL']>('logging.level'),
    logPersist: await g<boolean>('logging.persist'),
    logBufferSize: await g<number>('logging.bufferSize'),
    logRetentionDays: await g<number>('logging.retentionDays'),
    backupRetention: await g<number>('backup.retention'),
    backupScheduleHours: await g<number>('backup.scheduleHours'),
    webhooksEnabled: await g<boolean>('webhooks.enabled'),
    maxFileSize: await g<number>('storage.maxFileSize'),
    downloadMode: await g<'proxy' | 'redirect'>('storage.downloadMode'),
    email: {
      enabled: await g<boolean>('email.enabled'),
      host: await g<string>('email.smtp.host'),
      port: await g<number>('email.smtp.port'),
      secure: await g<boolean>('email.smtp.secure'),
      user: await g<string>('email.smtp.user'),
      password: await g<string>('email.smtp.password'),
      from: await g<string>('email.from'),
      replyTo: await g<string>('email.replyTo'),
      brandName: await g<string>('email.brandName'),
      brandColor: await g<string>('email.brandColor'),
    },
    oauth: {
      github: {
        enabled: await g<boolean>('oauth.github.enabled'),
        clientId: await g<string>('oauth.github.clientId'),
        clientSecret: await g<string>('oauth.github.clientSecret'),
      },
      google: {
        enabled: await g<boolean>('oauth.google.enabled'),
        clientId: await g<string>('oauth.google.clientId'),
        clientSecret: await g<string>('oauth.google.clientSecret'),
      },
      discord: {
        enabled: await g<boolean>('oauth.discord.enabled'),
        clientId: await g<string>('oauth.discord.clientId'),
        clientSecret: await g<string>('oauth.discord.clientSecret'),
      },
      microsoft: {
        enabled: await g<boolean>('oauth.microsoft.enabled'),
        clientId: await g<string>('oauth.microsoft.clientId'),
        clientSecret: await g<string>('oauth.microsoft.clientSecret'),
      },
      apple: {
        enabled: await g<boolean>('oauth.apple.enabled'),
        clientId: await g<string>('oauth.apple.clientId'),
        clientSecret: await g<string>('oauth.apple.clientSecret'),
      },
    },
  }
  runtimeCache = runtime
  try {
    const { setHardDeleteOverride } = await import('../config.js')
    setHardDeleteOverride(runtime.hardDeleteEnabled)
  } catch {
    // ignore
  }
  return runtime
}

export async function patchSettings(
  updates: Record<string, unknown>,
  opts: {
    updatedBy?: string | null
    confirm?: boolean
  } = {},
): Promise<{
  updated: string[]
  applyModes: SettingApplyMode[]
  requiresRestart: boolean
  requiresAuthRebuild: boolean
}> {
  const nodeEnv = env.NODE_ENV
  const updated: string[] = []
  const modes = new Set<SettingApplyMode>()

  for (const [key, value] of Object.entries(updates)) {
    const def = getSettingDef(key)
    if (!def) {
      throw Object.assign(new Error(`Unknown setting: ${key}`), {
        status: 400,
        code: 'VALIDATION_ERROR',
      })
    }
    if (def.dangerous && !opts.confirm) {
      throw Object.assign(
        new Error(
          `Changing "${key}" requires confirm: true because it is a dangerous setting`,
        ),
        { status: 400, code: 'CONFIRM_REQUIRED' },
      )
    }
    if (
      key === 'cors.origins' &&
      nodeEnv === 'production' &&
      typeof value === 'string' &&
      value.trim() === '*'
    ) {
      throw Object.assign(
        new Error('CORS_ORIGINS=* is not allowed in production'),
        { status: 400, code: 'VALIDATION_ERROR' },
      )
    }

    await upsertSetting(key, value, opts.updatedBy)
    updated.push(key)
    modes.add(def.applyMode)
  }

  invalidateSettingsCache()

  return {
    updated,
    applyModes: [...modes],
    requiresRestart: modes.has('restart'),
    requiresAuthRebuild: modes.has('auth_rebuild'),
  }
}

/** Sync helper used by middleware that historically read env.* */
export function getCachedRuntimeOrEnv(): Partial<EffectiveRuntime> {
  return runtimeCache || {}
}

export { ensureDefaultSettings }
