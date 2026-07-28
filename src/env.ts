import { z } from 'zod'

const envSchema = z
  .object({
    PORT: z.coerce.number().default(3000),
    DATABASE_URL: z.string().default('file:./data/app.db'),
    DATABASE_AUTH_TOKEN: z.string().optional(),
    BETTER_AUTH_SECRET: z.string().min(1, 'BETTER_AUTH_SECRET is required'),
    BETTER_AUTH_URL: z.string().url().default('http://localhost:3000'),
    STORAGE_PATH: z.string().default('./data/uploads'),
    STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
    MAX_FILE_SIZE: z.coerce.number().default(52428800), // 50MB
    S3_BUCKET: z.string().optional(),
    S3_REGION: z.string().optional(),
    S3_ENDPOINT: z.string().optional(),
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),
    S3_PREFIX: z.string().default(''),
    FILES_DOWNLOAD_MODE: z.enum(['proxy', 'redirect']).default('proxy'),
    S3_PRESIGN_EXPIRES: z.coerce.number().default(300),
    CORS_ORIGINS: z.string().default('*'),
    NODE_ENV: z
      .enum(['development', 'production', 'test'])
      .default('development'),
    HARD_DELETE_ENABLED: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
    REALTIME_ENABLED: z
      .enum(['true', 'false'])
      .default('true')
      .transform((v) => v === 'true'),
    REALTIME_REPLAY_BUFFER: z.coerce.number().default(100),
  })
  .superRefine((data, ctx) => {
    if (data.STORAGE_DRIVER !== 's3') return
    if (!data.S3_BUCKET) {
      ctx.addIssue({
        code: 'custom',
        path: ['S3_BUCKET'],
        message: 'S3_BUCKET is required when STORAGE_DRIVER=s3',
      })
    }
    if (!data.S3_ACCESS_KEY_ID) {
      ctx.addIssue({
        code: 'custom',
        path: ['S3_ACCESS_KEY_ID'],
        message: 'S3_ACCESS_KEY_ID is required when STORAGE_DRIVER=s3',
      })
    }
    if (!data.S3_SECRET_ACCESS_KEY) {
      ctx.addIssue({
        code: 'custom',
        path: ['S3_SECRET_ACCESS_KEY'],
        message: 'S3_SECRET_ACCESS_KEY is required when STORAGE_DRIVER=s3',
      })
    }
  })

export type Env = z.infer<typeof envSchema>

function generateDevSecret(): string {
  return 'dev-secret-change-in-production-' + Date.now()
}

function isProductionLike(nodeEnv: string): boolean {
  return nodeEnv === 'production'
}

let cached: Env | null = null

export function loadEnv(force = false): Env {
  if (cached && !force) return cached

  const nodeEnv = (process.env.NODE_ENV || 'development') as Env['NODE_ENV']
  const hasSecret = Boolean(process.env.BETTER_AUTH_SECRET)

  if (isProductionLike(nodeEnv) && !hasSecret) {
    throw new Error(
      'BETTER_AUTH_SECRET is required in production. Generate one with: openssl rand -base64 32',
    )
  }

  const parsed = envSchema.parse({
    PORT: process.env.PORT,
    DATABASE_URL: process.env.DATABASE_URL,
    DATABASE_AUTH_TOKEN: process.env.DATABASE_AUTH_TOKEN,
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET || generateDevSecret(),
    BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
    STORAGE_PATH: process.env.STORAGE_PATH,
    STORAGE_DRIVER: process.env.STORAGE_DRIVER,
    MAX_FILE_SIZE: process.env.MAX_FILE_SIZE,
    S3_BUCKET: process.env.S3_BUCKET,
    S3_REGION: process.env.S3_REGION,
    S3_ENDPOINT: process.env.S3_ENDPOINT,
    S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID,
    S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY,
    S3_PREFIX: process.env.S3_PREFIX,
    FILES_DOWNLOAD_MODE: process.env.FILES_DOWNLOAD_MODE,
    S3_PRESIGN_EXPIRES: process.env.S3_PRESIGN_EXPIRES,
    CORS_ORIGINS: process.env.CORS_ORIGINS,
    NODE_ENV: process.env.NODE_ENV,
    HARD_DELETE_ENABLED: process.env.HARD_DELETE_ENABLED,
    REALTIME_ENABLED: process.env.REALTIME_ENABLED,
    REALTIME_REPLAY_BUFFER: process.env.REALTIME_REPLAY_BUFFER,
  })

  if (!hasSecret && !isProductionLike(parsed.NODE_ENV)) {
    console.warn(
      '⚠️  WARNING: Using auto-generated development BETTER_AUTH_SECRET. Set BETTER_AUTH_SECRET in production.',
    )
  }

  if (
    isProductionLike(parsed.NODE_ENV) &&
    parsed.CORS_ORIGINS.trim() === '*'
  ) {
    throw new Error(
      'CORS_ORIGINS=* is not allowed with credentials in production. Set an explicit comma-separated origin list.',
    )
  }

  cached = parsed
  return cached
}

/** Reset cached env — for tests only */
export function resetEnvForTests(): void {
  cached = null
}

const env: Env = new Proxy({} as Env, {
  get(_target, prop: string) {
    return loadEnv()[prop as keyof Env]
  },
})

export default env
