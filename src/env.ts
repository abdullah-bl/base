import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().default('file:./data/app.db'),
  DATABASE_AUTH_TOKEN: z.string().optional(),
  BETTER_AUTH_SECRET: z.string().min(1, 'BETTER_AUTH_SECRET is required'),
  BETTER_AUTH_URL: z.string().url().default('http://localhost:3000'),
  STORAGE_PATH: z.string().default('./data/uploads'),
  MAX_FILE_SIZE: z.coerce.number().default(52428800), // 50MB
  CORS_ORIGINS: z.string().default('*'),
});

// Generate a default secret for development if not set
function generateDevSecret(): string {
  return 'dev-secret-change-in-production-' + Date.now();
}

let env: z.infer<typeof envSchema>;

try {
  const parsed = envSchema.parse({
    PORT: process.env.PORT,
    DATABASE_URL: process.env.DATABASE_URL,
    DATABASE_AUTH_TOKEN: process.env.DATABASE_AUTH_TOKEN,
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET || generateDevSecret(),
    BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
    STORAGE_PATH: process.env.STORAGE_PATH,
    MAX_FILE_SIZE: process.env.MAX_FILE_SIZE,
    CORS_ORIGINS: process.env.CORS_ORIGINS,
  });
  env = parsed;

  // Warn about using development secret
  if (!process.env.BETTER_AUTH_SECRET) {
    console.warn('⚠️  WARNING: Using auto-generated development BETTER_AUTH_SECRET. Set BETTER_AUTH_SECRET in production.');
  }
} catch (error: unknown) {
  console.error('❌ Environment validation failed:', error);
  throw error;
}

export default env;