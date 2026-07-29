import { existsSync } from 'node:fs'
import env, { loadEnv } from '../env.js'
import { getClient } from '../db/client.js'
import { getEffectiveRuntime } from '../settings/resolve.js'
import { listApiKeys } from '../auth/api-keys.js'
import { countAdmins } from '../auth/onboarding.js'

export interface SecurityCheck {
  id: string
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info'
  ok: boolean
  title: string
  detail: string
  remediations?: string[]
}

export interface SecurityReport {
  score: number
  passed: number
  failed: number
  checks: SecurityCheck[]
}

export async function runSecurityChecklist(): Promise<SecurityReport> {
  const e = loadEnv()
  const runtime = await getEffectiveRuntime()
  const checks: SecurityCheck[] = []

  const isProd = e.NODE_ENV === 'production'

  checks.push({
    id: 'secret_present',
    severity: 'critical',
    ok: Boolean(process.env.BETTER_AUTH_SECRET && process.env.BETTER_AUTH_SECRET.length >= 32),
    title: 'BETTER_AUTH_SECRET configured',
    detail: process.env.BETTER_AUTH_SECRET
      ? 'Secret is set'
      : 'Missing or auto-generated secret',
    remediations: ['Set BETTER_AUTH_SECRET to openssl rand -base64 32'],
  })

  checks.push({
    id: 'cors_prod',
    severity: 'critical',
    ok: !(isProd && runtime.corsOrigins.trim() === '*'),
    title: 'CORS origins locked down in production',
    detail: `cors.origins=${runtime.corsOrigins}`,
    remediations: ['Set explicit origins in Admin → Settings → CORS'],
  })

  checks.push({
    id: 'https_url',
    severity: isProd ? 'high' : 'info',
    ok: !isProd || runtime.publicUrl.startsWith('https://'),
    title: 'Public URL uses HTTPS in production',
    detail: runtime.publicUrl,
  })

  checks.push({
    id: 'rate_limit',
    severity: 'medium',
    ok: runtime.rateLimitEnabled,
    title: 'Rate limiting enabled',
    detail: runtime.rateLimitEnabled
      ? `${runtime.rateLimitMax}/${runtime.rateLimitWindowMs}ms`
      : 'Disabled',
    remediations: ['Enable rateLimit.enabled in Settings'],
  })

  checks.push({
    id: 'hard_delete',
    severity: 'medium',
    ok: !runtime.hardDeleteEnabled,
    title: 'Hard delete disabled by default',
    detail: runtime.hardDeleteEnabled ? 'Hard delete is ON' : 'Soft delete only',
  })

  const admins = await countAdmins()
  checks.push({
    id: 'has_admin',
    severity: 'critical',
    ok: admins >= 1,
    title: 'At least one admin user',
    detail: `${admins} admin(s)`,
  })

  checks.push({
    id: 'public_signup',
    severity: isProd ? 'high' : 'low',
    ok: !isProd || !runtime.allowPublicSignup,
    title: 'Public signup disabled in production',
    detail: runtime.allowPublicSignup ? 'Open signup enabled' : 'Signup restricted',
  })

  const keys = await listApiKeys()
  const starKeys = keys.filter((k) => !k.revokedAt && k.scopes.includes('*'))
  checks.push({
    id: 'api_key_scopes',
    severity: 'high',
    ok: starKeys.length === 0,
    title: 'No wildcard API keys',
    detail:
      starKeys.length === 0
        ? 'All active keys are scoped'
        : `${starKeys.length} key(s) with scope "*"`,
    remediations: ['Revoke wildcard keys and reissue with least privilege'],
  })

  const masterKeyEnv = Boolean(process.env.BASE_MASTER_KEY)
  const masterKeyFile = existsSync(
    process.env.BASE_MASTER_KEY_FILE || `${process.cwd()}/data/.base-master-key`,
  )
  checks.push({
    id: 'master_key',
    severity: isProd ? 'high' : 'info',
    ok: masterKeyEnv || masterKeyFile || Boolean(process.env.BETTER_AUTH_SECRET),
    title: 'Settings encryption key available',
    detail: masterKeyEnv
      ? 'BASE_MASTER_KEY from env'
      : masterKeyFile
        ? 'Local master key file'
        : 'Derived from BETTER_AUTH_SECRET',
  })

  // Public collections warning
  try {
    const { getRegisteredCollections } = await import('../schema/registry.js')
    const { getAccessLevel } = await import('../collections/access.js')
    const pubs = getRegisteredCollections().filter(
      (c) =>
        c.name !== 'user' &&
        c.name !== 'users' &&
        getAccessLevel(c, 'read') === 'public',
    )
    checks.push({
      id: 'public_read_collections',
      severity: 'medium',
      ok: pubs.length === 0,
      title: 'No unintended public-read collections',
      detail:
        pubs.length === 0
          ? 'None'
          : pubs.map((c) => c.name).join(', '),
    })
  } catch {
    checks.push({
      id: 'public_read_collections',
      severity: 'info',
      ok: true,
      title: 'Public-read collections',
      detail: 'Unable to inspect registry',
    })
  }

  try {
    await getClient().execute('SELECT 1')
    checks.push({
      id: 'db_reachable',
      severity: 'critical',
      ok: true,
      title: 'Database reachable',
      detail: e.DATABASE_URL,
    })
  } catch (err) {
    checks.push({
      id: 'db_reachable',
      severity: 'critical',
      ok: false,
      title: 'Database reachable',
      detail: err instanceof Error ? err.message : 'error',
    })
  }

  // silence unused
  void env

  const passed = checks.filter((c) => c.ok).length
  const failed = checks.length - passed
  const weights: Record<SecurityCheck['severity'], number> = {
    critical: 25,
    high: 15,
    medium: 8,
    low: 4,
    info: 2,
  }
  let total = 0
  let earned = 0
  for (const c of checks) {
    total += weights[c.severity]
    if (c.ok) earned += weights[c.severity]
  }
  const score = total === 0 ? 100 : Math.round((earned / total) * 100)

  return { score, passed, failed, checks }
}
