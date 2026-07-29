import { createHash, randomBytes } from 'node:crypto'
import { getClient } from '../db/client.js'
import { getAuth, setUserRole } from './auth.js'
import { getEffectiveRuntime, patchSettings } from '../settings/resolve.js'
import { upsertSetting } from '../settings/store.js'

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export async function getOnboardingStatus(): Promise<{
  needsSetup: boolean
  hasAdmin: boolean
  setupCompleted: boolean
  hasSetupToken: boolean
  collectionsCount: number
}> {
  const client = getClient()
  let admins = 0
  try {
    const r = await client.execute(
      `SELECT COUNT(*) as total FROM "user" WHERE "role" = 'admin'`,
    )
    admins = Number(r.rows[0]?.total || 0)
  } catch {
    admins = 0
  }

  let collectionsCount = 0
  try {
    const r = await client.execute(
      `SELECT COUNT(*) as total FROM "_base_collections"`,
    )
    collectionsCount = Number(r.rows[0]?.total || 0)
  } catch {
    collectionsCount = 0
  }

  const runtime = await getEffectiveRuntime()
  const row = await client.execute(
    `SELECT * FROM "_base_onboarding" WHERE "id" = 'default' LIMIT 1`,
  )
  const hasSetupToken = Boolean(
    (row.rows?.[0] as { setupTokenHash?: string } | undefined)?.setupTokenHash,
  )

  const hasAdmin = admins > 0
  const setupCompleted = Boolean(runtime.setupCompleted) || hasAdmin
  return {
    needsSetup: !setupCompleted,
    hasAdmin,
    setupCompleted,
    hasSetupToken,
    collectionsCount,
  }
}

/** Ensure a setup token exists when no admin yet; returns plaintext once. */
export async function ensureSetupToken(): Promise<string | null> {
  const status = await getOnboardingStatus()
  if (!status.needsSetup) return null

  const client = getClient()
  const existing = await client.execute(
    `SELECT * FROM "_base_onboarding" WHERE "id" = 'default' LIMIT 1`,
  )
  if (existing.rows?.length) {
    // Do not re-issue; operator must use CLI if lost
    return null
  }

  const token = randomBytes(24).toString('base64url')
  const now = Date.now()
  await client.execute({
    sql: `INSERT INTO "_base_onboarding" ("id","setupTokenHash","completedAt","createdAt")
          VALUES ('default', ?, NULL, ?)`,
    args: [hashToken(token), now],
  })
  return token
}

export async function assertSetupToken(token: string | undefined): Promise<void> {
  if (!token) {
    throw Object.assign(new Error('Setup token required'), {
      status: 401,
      code: 'UNAUTHORIZED',
    })
  }
  const client = getClient()
  const row = await client.execute(
    `SELECT "setupTokenHash","completedAt" FROM "_base_onboarding" WHERE "id" = 'default' LIMIT 1`,
  )
  const data = row.rows?.[0] as
    | { setupTokenHash?: string; completedAt?: number }
    | undefined
  if (data?.completedAt) {
    throw Object.assign(new Error('Onboarding already completed'), {
      status: 409,
      code: 'SETUP_COMPLETED',
    })
  }
  if (!data?.setupTokenHash || data.setupTokenHash !== hashToken(token)) {
    throw Object.assign(new Error('Invalid setup token'), {
      status: 401,
      code: 'UNAUTHORIZED',
    })
  }
}

export async function completeOnboarding(opts: {
  setupToken: string
  email: string
  password: string
  name?: string
  appName?: string
  publicUrl?: string
  corsOrigins?: string
}): Promise<{ userId: string }> {
  await assertSetupToken(opts.setupToken)

  const status = await getOnboardingStatus()
  if (status.hasAdmin) {
    throw Object.assign(new Error('Admin already exists'), {
      status: 409,
      code: 'SETUP_COMPLETED',
    })
  }

  const auth = getAuth()
  const result = await auth.api.signUpEmail({
    body: {
      email: opts.email,
      password: opts.password,
      name: opts.name || 'Admin',
    },
  })

  const userId =
    (result as { user?: { id?: string } })?.user?.id ||
    (await lookupUserId(opts.email))

  if (!userId) {
    throw Object.assign(new Error('Failed to create admin user'), {
      status: 500,
      code: 'INTERNAL',
    })
  }

  await setUserRole(userId, 'admin')

  if (opts.appName) {
    await upsertSetting('app.name', opts.appName, userId)
  }
  if (opts.publicUrl) {
    await upsertSetting('app.publicUrl', opts.publicUrl, userId)
  }
  if (opts.corsOrigins) {
    await upsertSetting('cors.origins', opts.corsOrigins, userId)
  }

  await patchSettings(
    { 'app.setupCompleted': true, 'auth.allowPublicSignup': false },
    { updatedBy: userId, confirm: true },
  )

  const client = getClient()
  await client.execute({
    sql: `UPDATE "_base_onboarding"
          SET "completedAt" = ?, "setupTokenHash" = NULL
          WHERE "id" = 'default'`,
    args: [Date.now()],
  })

  return { userId }
}

async function lookupUserId(email: string): Promise<string | null> {
  const client = getClient()
  const r = await client.execute({
    sql: `SELECT "id" FROM "user" WHERE "email" = ? LIMIT 1`,
    args: [email],
  })
  const id = r.rows?.[0]?.id
  return id ? String(id) : null
}

export async function countAdmins(): Promise<number> {
  const client = getClient()
  const r = await client.execute(
    `SELECT COUNT(*) as total FROM "user" WHERE "role" = 'admin'`,
  )
  return Number(r.rows[0]?.total || 0)
}
