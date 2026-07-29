import { z } from 'zod'

export type SettingApplyMode = 'immediate' | 'auth_rebuild' | 'restart'
export type SettingSource = 'bootstrap' | 'env' | 'db' | 'default'
export type SettingSection =
  | 'general'
  | 'auth'
  | 'oauth'
  | 'email'
  | 'security'
  | 'cors'
  | 'rate_limit'
  | 'realtime'
  | 'logging'
  | 'backup'
  | 'storage'
  | 'webhooks'

export interface SettingDef {
  key: string
  section: SettingSection
  description: string
  /** Zod schema for the JSON value */
  schema: z.ZodTypeAny
  default: unknown
  secret?: boolean
  /** Must stay in env / bootstrap — not writable via Admin */
  bootstrapOnly?: boolean
  applyMode: SettingApplyMode
  /** Dangerous toggles require confirm: true on PATCH */
  dangerous?: boolean
}

const bool = z.boolean()
const str = z.string()
const num = z.number().finite()

export const SETTING_DEFS: SettingDef[] = [
  // General
  {
    key: 'app.name',
    section: 'general',
    description: 'Project display name',
    schema: str.min(1).max(120),
    default: 'Base',
    applyMode: 'immediate',
  },
  {
    key: 'app.publicUrl',
    section: 'general',
    description: 'Public base URL (used for OAuth callbacks and emails)',
    schema: z.string().url(),
    default: 'http://localhost:3000',
    applyMode: 'auth_rebuild',
  },
  {
    key: 'app.setupCompleted',
    section: 'general',
    description: 'Whether first-time onboarding finished',
    schema: bool,
    default: false,
    applyMode: 'immediate',
  },

  // Auth
  {
    key: 'auth.allowPublicSignup',
    section: 'auth',
    description: 'Allow open email/password registration',
    schema: bool,
    default: true,
    applyMode: 'auth_rebuild',
  },
  {
    key: 'auth.requireEmailVerification',
    section: 'auth',
    description: 'Require verified email before sign-in',
    schema: bool,
    default: false,
    applyMode: 'auth_rebuild',
  },
  {
    key: 'auth.adminEmails',
    section: 'auth',
    description: 'Comma-separated emails auto-promoted to admin',
    schema: str,
    default: '',
    applyMode: 'immediate',
  },

  // OAuth
  {
    key: 'oauth.github.enabled',
    section: 'oauth',
    description: 'Enable GitHub OAuth',
    schema: bool,
    default: false,
    applyMode: 'auth_rebuild',
  },
  {
    key: 'oauth.github.clientId',
    section: 'oauth',
    description: 'GitHub OAuth client ID',
    schema: str,
    default: '',
    applyMode: 'auth_rebuild',
  },
  {
    key: 'oauth.github.clientSecret',
    section: 'oauth',
    description: 'GitHub OAuth client secret',
    schema: str,
    default: '',
    secret: true,
    applyMode: 'auth_rebuild',
  },
  {
    key: 'oauth.google.enabled',
    section: 'oauth',
    description: 'Enable Google OAuth',
    schema: bool,
    default: false,
    applyMode: 'auth_rebuild',
  },
  {
    key: 'oauth.google.clientId',
    section: 'oauth',
    description: 'Google OAuth client ID',
    schema: str,
    default: '',
    applyMode: 'auth_rebuild',
  },
  {
    key: 'oauth.google.clientSecret',
    section: 'oauth',
    description: 'Google OAuth client secret',
    schema: str,
    default: '',
    secret: true,
    applyMode: 'auth_rebuild',
  },
  {
    key: 'oauth.discord.enabled',
    section: 'oauth',
    description: 'Enable Discord OAuth',
    schema: bool,
    default: false,
    applyMode: 'auth_rebuild',
  },
  {
    key: 'oauth.discord.clientId',
    section: 'oauth',
    description: 'Discord OAuth client ID',
    schema: str,
    default: '',
    applyMode: 'auth_rebuild',
  },
  {
    key: 'oauth.discord.clientSecret',
    section: 'oauth',
    description: 'Discord OAuth client secret',
    schema: str,
    default: '',
    secret: true,
    applyMode: 'auth_rebuild',
  },
  {
    key: 'oauth.microsoft.enabled',
    section: 'oauth',
    description: 'Enable Microsoft OAuth',
    schema: bool,
    default: false,
    applyMode: 'auth_rebuild',
  },
  {
    key: 'oauth.microsoft.clientId',
    section: 'oauth',
    description: 'Microsoft OAuth client ID',
    schema: str,
    default: '',
    applyMode: 'auth_rebuild',
  },
  {
    key: 'oauth.microsoft.clientSecret',
    section: 'oauth',
    description: 'Microsoft OAuth client secret',
    schema: str,
    default: '',
    secret: true,
    applyMode: 'auth_rebuild',
  },
  {
    key: 'oauth.apple.enabled',
    section: 'oauth',
    description: 'Enable Apple OAuth',
    schema: bool,
    default: false,
    applyMode: 'auth_rebuild',
  },
  {
    key: 'oauth.apple.clientId',
    section: 'oauth',
    description: 'Apple OAuth client ID',
    schema: str,
    default: '',
    applyMode: 'auth_rebuild',
  },
  {
    key: 'oauth.apple.clientSecret',
    section: 'oauth',
    description: 'Apple OAuth client secret',
    schema: str,
    default: '',
    secret: true,
    applyMode: 'auth_rebuild',
  },

  // Email / SMTP
  {
    key: 'email.enabled',
    section: 'email',
    description: 'Enable outbound email',
    schema: bool,
    default: false,
    applyMode: 'auth_rebuild',
  },
  {
    key: 'email.smtp.host',
    section: 'email',
    description: 'SMTP host',
    schema: str,
    default: '',
    applyMode: 'immediate',
  },
  {
    key: 'email.smtp.port',
    section: 'email',
    description: 'SMTP port',
    schema: num.int().min(1).max(65535),
    default: 587,
    applyMode: 'immediate',
  },
  {
    key: 'email.smtp.secure',
    section: 'email',
    description: 'Use TLS (true for port 465)',
    schema: bool,
    default: false,
    applyMode: 'immediate',
  },
  {
    key: 'email.smtp.user',
    section: 'email',
    description: 'SMTP username',
    schema: str,
    default: '',
    applyMode: 'immediate',
  },
  {
    key: 'email.smtp.password',
    section: 'email',
    description: 'SMTP password',
    schema: str,
    default: '',
    secret: true,
    applyMode: 'immediate',
  },
  {
    key: 'email.from',
    section: 'email',
    description: 'From address',
    schema: str,
    default: 'noreply@localhost',
    applyMode: 'immediate',
  },
  {
    key: 'email.replyTo',
    section: 'email',
    description: 'Reply-To address',
    schema: str,
    default: '',
    applyMode: 'immediate',
  },
  {
    key: 'email.brandName',
    section: 'email',
    description: 'Brand name used in email templates',
    schema: str,
    default: 'Base',
    applyMode: 'immediate',
  },
  {
    key: 'email.brandColor',
    section: 'email',
    description: 'Brand accent color (hex)',
    schema: z.string().regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/),
    default: '#0F766E',
    applyMode: 'immediate',
  },

  // Security / ops
  {
    key: 'security.hardDeleteEnabled',
    section: 'security',
    description: 'Allow hard deletes via ?hard=true',
    schema: bool,
    default: false,
    dangerous: true,
    applyMode: 'immediate',
  },
  {
    key: 'cors.origins',
    section: 'cors',
    description: 'Comma-separated CORS origins (* forbidden in production)',
    schema: str,
    default: '*',
    applyMode: 'auth_rebuild',
  },
  {
    key: 'rateLimit.enabled',
    section: 'rate_limit',
    description: 'Enable rate limiting',
    schema: bool,
    default: true,
    dangerous: true,
    applyMode: 'immediate',
  },
  {
    key: 'rateLimit.windowMs',
    section: 'rate_limit',
    description: 'Rate limit window in milliseconds',
    schema: num.int().min(1000),
    default: 60_000,
    applyMode: 'immediate',
  },
  {
    key: 'rateLimit.max',
    section: 'rate_limit',
    description: 'Max requests per window (API)',
    schema: num.int().min(1),
    default: 120,
    applyMode: 'immediate',
  },
  {
    key: 'rateLimit.authMax',
    section: 'rate_limit',
    description: 'Max requests per window (auth)',
    schema: num.int().min(1),
    default: 20,
    applyMode: 'immediate',
  },
  {
    key: 'realtime.enabled',
    section: 'realtime',
    description: 'Enable SSE realtime',
    schema: bool,
    default: true,
    applyMode: 'immediate',
  },
  {
    key: 'realtime.replayBuffer',
    section: 'realtime',
    description: 'SSE replay buffer size',
    schema: num.int().min(0).max(10_000),
    default: 100,
    applyMode: 'immediate',
  },
  {
    key: 'logging.level',
    section: 'logging',
    description: 'Log level',
    schema: z.enum(['debug', 'info', 'warn', 'error']),
    default: 'info',
    applyMode: 'immediate',
  },
  {
    key: 'logging.persist',
    section: 'logging',
    description: 'Persist logs to SQLite',
    schema: bool,
    default: true,
    applyMode: 'immediate',
  },
  {
    key: 'logging.bufferSize',
    section: 'logging',
    description: 'In-memory log buffer size',
    schema: num.int().min(50).max(50_000),
    default: 500,
    applyMode: 'immediate',
  },
  {
    key: 'logging.retentionDays',
    section: 'logging',
    description: 'Days to retain persisted logs',
    schema: num.int().min(1).max(3650),
    default: 14,
    applyMode: 'immediate',
  },
  {
    key: 'backup.retention',
    section: 'backup',
    description: 'Number of backups to keep',
    schema: num.int().min(1).max(1000),
    default: 10,
    applyMode: 'immediate',
  },
  {
    key: 'backup.scheduleHours',
    section: 'backup',
    description: 'Automatic backup interval in hours (0 = off)',
    schema: num.int().min(0).max(24 * 30),
    default: 0,
    applyMode: 'restart',
  },
  {
    key: 'webhooks.enabled',
    section: 'webhooks',
    description: 'Enable outbound webhooks',
    schema: bool,
    default: false,
    applyMode: 'immediate',
  },
  {
    key: 'storage.maxFileSize',
    section: 'storage',
    description: 'Max upload size in bytes',
    schema: num.int().min(1024),
    default: 52_428_800,
    applyMode: 'immediate',
  },
  {
    key: 'storage.downloadMode',
    section: 'storage',
    description: 'File download mode',
    schema: z.enum(['proxy', 'redirect']),
    default: 'proxy',
    applyMode: 'immediate',
  },
]

export const SETTING_DEF_MAP = new Map(SETTING_DEFS.map((d) => [d.key, d]))

export function getSettingDef(key: string): SettingDef | undefined {
  return SETTING_DEF_MAP.get(key)
}

/** Map legacy env keys → settings keys for seeding */
export const ENV_TO_SETTING: Record<string, string> = {
  BETTER_AUTH_URL: 'app.publicUrl',
  ADMIN_EMAILS: 'auth.adminEmails',
  HARD_DELETE_ENABLED: 'security.hardDeleteEnabled',
  CORS_ORIGINS: 'cors.origins',
  RATE_LIMIT_ENABLED: 'rateLimit.enabled',
  RATE_LIMIT_WINDOW_MS: 'rateLimit.windowMs',
  RATE_LIMIT_MAX: 'rateLimit.max',
  RATE_LIMIT_AUTH_MAX: 'rateLimit.authMax',
  REALTIME_ENABLED: 'realtime.enabled',
  REALTIME_REPLAY_BUFFER: 'realtime.replayBuffer',
  LOG_LEVEL: 'logging.level',
  LOG_PERSIST: 'logging.persist',
  LOG_BUFFER_SIZE: 'logging.bufferSize',
  LOG_RETENTION_DAYS: 'logging.retentionDays',
  BACKUP_RETENTION: 'backup.retention',
  BACKUP_SCHEDULE_HOURS: 'backup.scheduleHours',
  WEBHOOKS_ENABLED: 'webhooks.enabled',
  MAX_FILE_SIZE: 'storage.maxFileSize',
  FILES_DOWNLOAD_MODE: 'storage.downloadMode',
}
