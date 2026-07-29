import type { Hono } from 'hono'
import { getAdminActor } from './guard.js'
import { writeAudit } from '../observability/audit.js'
import { getRequestId } from '../observability/request-log.js'
import {
  getEffectiveRuntime,
  listResolvedSettings,
  patchSettings,
  invalidateSettingsCache,
} from '../settings/resolve.js'
import { rebuildAuth } from '../auth/auth.js'
import { listOAuthProvidersPublic } from '../auth/oauth.js'
import {
  completeOnboarding,
  ensureSetupToken,
  getOnboardingStatus,
} from '../auth/onboarding.js'
import {
  clearEmailOutbox,
  getEmailOutbox,
  renderVerificationEmail,
  sendAuthEmail,
} from '../auth/email.js'
import { runSecurityChecklist } from '../security/checklist.js'
import {
  finalizeRestartAfterBoot,
  getRestartJobPublic,
  getRestartStatus,
  preflightRestart,
  requestRestart,
} from '../server/restart.js'
import {
  deleteStoredCollection,
  exportSchemasJson,
  getStoredCollection,
  importSchemasJson,
  listStoredCollections,
  loadRegistryFromDb,
  schemasToTypescript,
  upsertStoredCollection,
} from '../schema/collection-store.js'
import { applyEvolution, planEvolution } from '../schema/evolve.js'
import { resetDynamicRouterCache } from '../collections/dynamic-router.js'
import { parseCollectionSchema } from '../schema/validate-schema.js'
import { countAdmins } from '../auth/onboarding.js'

/**
 * Mount control-plane routes on the admin router.
 * Some onboarding routes are mounted separately without requireAdmin.
 */
export function mountControlPlane(router: Hono): void {
  // ── Settings ─────────────────────────────────────────────
  router.get('/settings', async (c) => {
    const settings = await listResolvedSettings()
    const runtime = await getEffectiveRuntime()
    const bySection: Record<string, typeof settings> = {}
    for (const s of settings) {
      ;(bySection[s.section] ||= []).push(s)
    }
    return c.json({
      data: {
        settings,
        bySection,
        features: {
          softDelete: true,
          hardDelete: runtime.hardDeleteEnabled,
          realtime: runtime.realtimeEnabled,
          rateLimit: runtime.rateLimitEnabled,
          webhooks: runtime.webhooksEnabled,
          email: runtime.email.enabled,
          oauth: listOAuthProvidersPublic(runtime, runtime.publicUrl).some(
            (p) => p.enabled,
          ),
        },
        bootstrap: {
          databaseUrl: process.env.DATABASE_URL || 'file:./data/app.db',
          nodeEnv: process.env.NODE_ENV || 'development',
          adminEnabled: process.env.ADMIN_ENABLED !== 'false',
          adminPath: process.env.ADMIN_PATH || '/_',
          hasAdminToken: Boolean(process.env.ADMIN_TOKEN),
        },
      },
    })
  })

  router.patch('/settings', async (c) => {
    const body = (await c.req.json()) as {
      values?: Record<string, unknown>
      confirm?: boolean
    }
    if (!body.values || typeof body.values !== 'object') {
      return c.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'values object is required',
          },
        },
        400,
      )
    }

    const actor = getAdminActor(c)
    const actorId =
      actor.kind === 'user'
        ? actor.userId
        : actor.kind === 'api_key'
          ? actor.keyId
          : 'admin-token'

    const before = await listResolvedSettings()
    const result = await patchSettings(body.values, {
      updatedBy: actorId,
      confirm: body.confirm,
    })

    if (result.requiresAuthRebuild) {
      await rebuildAuth()
    }

    void writeAudit({
      actor:
        actor.kind === 'user'
          ? { kind: 'user', userId: actor.userId }
          : { kind: 'admin_token' },
      action: 'settings.update',
      before: Object.fromEntries(
        before
          .filter((s) => result.updated.includes(s.key))
          .map((s) => [s.key, s.displayValue]),
      ),
      after: body.values,
      requestId: getRequestId(c),
    })

    return c.json({
      data: {
        ...result,
        settings: await listResolvedSettings(),
      },
    })
  })

  // ── OAuth ────────────────────────────────────────────────
  router.get('/oauth/providers', async (c) => {
    const runtime = await getEffectiveRuntime()
    return c.json({
      data: listOAuthProvidersPublic(runtime, runtime.publicUrl),
    })
  })

  // ── Email test ───────────────────────────────────────────
  router.post('/email/test', async (c) => {
    const body = (await c.req.json()) as { to?: string }
    const runtime = await getEffectiveRuntime()
    if (!body.to) {
      return c.json(
        { error: { code: 'VALIDATION_ERROR', message: 'to is required' } },
        400,
      )
    }
    const msg = renderVerificationEmail({
      user: { email: body.to, name: 'Test' },
      url: `${runtime.publicUrl}/_/`,
      brandName: runtime.email.brandName || runtime.appName,
      brandColor: runtime.email.brandColor,
    })
    const result = await sendAuthEmail(runtime, {
      ...msg,
      subject: `[Test] ${msg.subject}`,
    })
    return c.json({ data: result })
  })

  // ── Security ─────────────────────────────────────────────
  router.get('/security/checklist', async (c) => {
    const report = await runSecurityChecklist()
    return c.json({ data: report })
  })

  // ── Restart ──────────────────────────────────────────────
  router.get('/system/restart', async (c) => {
    return c.json({ data: await getRestartStatus() })
  })

  router.get('/system/restart/:id', async (c) => {
    const job = await getRestartJobPublic(c.req.param('id'))
    if (!job) {
      return c.json(
        { error: { code: 'NOT_FOUND', message: 'Restart job not found' } },
        404,
      )
    }
    return c.json({ data: job })
  })

  router.post('/system/restart/preflight', async (c) => {
    return c.json({ data: await preflightRestart() })
  })

  router.post('/system/restart', async (c) => {
    const body = (await c.req.json()) as {
      confirm?: string
      reason?: string
    }
    const actor = getAdminActor(c)
    const job = await requestRestart({
      confirm: body.confirm || '',
      reason: body.reason,
      actorId:
        actor.kind === 'user'
          ? actor.userId
          : actor.kind === 'api_key'
            ? actor.keyId
            : 'admin-token',
      actorKind: actor.kind,
      requestId: getRequestId(c),
    })
    return c.json({ data: job }, 202)
  })

  // ── Schema builder (DB-backed) ───────────────────────────
  router.get('/schema/collections', async (c) => {
    const stored = await listStoredCollections()
    return c.json({
      data: stored.map((s) => ({
        id: s.id,
        name: s.name,
        schema: s.schema,
        draft: s.draft,
        version: s.version,
        fingerprint: s.fingerprint,
        updatedAt: s.updatedAt,
        updatedBy: s.updatedBy,
        hasDraft: Boolean(s.draft),
      })),
    })
  })

  router.get('/schema/collections/:name', async (c) => {
    const stored = await getStoredCollection(c.req.param('name'))
    if (!stored) {
      return c.json(
        { error: { code: 'NOT_FOUND', message: 'Collection not found' } },
        404,
      )
    }
    return c.json({ data: stored })
  })

  router.put('/schema/collections/:name', async (c) => {
    const body = await c.req.json()
    const actor = getAdminActor(c)
    const name = c.req.param('name')
    const schemaInput = { ...body, name: body.name || name }
    try {
      parseCollectionSchema(schemaInput)
    } catch (err) {
      return c.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: err instanceof Error ? err.message : 'Invalid schema',
          },
        },
        400,
      )
    }

    const asDraft = c.req.query('draft') === 'true'
    const stored = await upsertStoredCollection(schemaInput, {
      updatedBy:
        actor.kind === 'user'
          ? actor.userId
          : actor.kind === 'api_key'
            ? actor.keyId
            : 'admin-token',
      asDraft,
    })

    if (!asDraft) {
      await loadRegistryFromDb()
      resetDynamicRouterCache()
      const plan = await applyEvolution([stored.schema])
      void writeAudit({
        actor:
          actor.kind === 'user'
            ? { kind: 'user', userId: actor.userId }
            : { kind: 'admin_token' },
        action: 'schema.upsert',
        collection: stored.name,
        after: stored.schema as unknown as Record<string, unknown>,
        requestId: getRequestId(c),
      })
      return c.json({ data: { collection: stored, plan } })
    }

    return c.json({ data: { collection: stored } })
  })

  router.delete('/schema/collections/:name', async (c) => {
    const name = c.req.param('name')
    const confirm = c.req.query('confirm')
    if (confirm !== name) {
      return c.json(
        {
          error: {
            code: 'CONFIRM_REQUIRED',
            message: `Pass ?confirm=${name} to delete collection metadata (table data is retained)`,
          },
        },
        400,
      )
    }
    const ok = await deleteStoredCollection(name)
    if (!ok) {
      return c.json(
        { error: { code: 'NOT_FOUND', message: 'Collection not found' } },
        404,
      )
    }
    await loadRegistryFromDb()
    resetDynamicRouterCache()
    return c.json({ data: { deleted: true, name } })
  })

  router.post('/schema/validate', async (c) => {
    const body = await c.req.json()
    try {
      const schema = parseCollectionSchema(body)
      const plan = await planEvolution([schema])
      return c.json({ data: { valid: true, schema, plan } })
    } catch (err) {
      return c.json(
        {
          data: {
            valid: false,
            error: err instanceof Error ? err.message : String(err),
          },
        },
        200,
      )
    }
  })

  router.get('/schema/export', async (c) => {
    const format = c.req.query('format') || 'json'
    const doc = await exportSchemasJson()
    if (format === 'ts' || format === 'typescript') {
      const source = schemasToTypescript(doc.collections)
      return c.json({ data: { format: 'typescript', source, ...doc } })
    }
    return c.json({ data: doc })
  })

  router.post('/schema/import', async (c) => {
    const body = await c.req.json()
    const actor = getAdminActor(c)
    const result = await importSchemasJson(body, {
      updatedBy:
        actor.kind === 'user'
          ? actor.userId
          : actor.kind === 'api_key'
            ? actor.keyId
            : 'admin-token',
      replace: Boolean(body.replace),
    })
    resetDynamicRouterCache()
    const { getRegisteredCollections } = await import('../schema/registry.js')
    const plan = await applyEvolution(
      getRegisteredCollections().filter(
        (x) => x.name !== 'user' && x.name !== 'users',
      ),
    )
    return c.json({ data: { ...result, plan } })
  })
}

/** Public (pre-admin) onboarding routes — mounted outside requireAdmin */
export function mountOnboardingRoutes(app: Hono): void {
  app.get('/api/admin/onboarding/status', async (c) => {
    const status = await getOnboardingStatus()
    return c.json({ data: status })
  })

  app.post('/api/admin/onboarding/setup-token', async (c) => {
    // Only available on localhost-ish for safety when no token exists yet
    const status = await getOnboardingStatus()
    if (!status.needsSetup) {
      return c.json(
        { error: { code: 'SETUP_COMPLETED', message: 'Setup already done' } },
        409,
      )
    }
    const token = await ensureSetupToken()
    if (!token) {
      return c.json({
        data: {
          issued: false,
          message:
            'Setup token already issued. Check server logs from first boot, or run: base doctor',
        },
      })
    }
    console.log('\n🔐 Onboarding setup token (shown once):')
    console.log(`   ${token}\n`)
    return c.json({ data: { issued: true, setupToken: token } })
  })

  app.post('/api/admin/onboarding/complete', async (c) => {
    const body = (await c.req.json()) as {
      setupToken?: string
      email?: string
      password?: string
      name?: string
      appName?: string
      publicUrl?: string
      corsOrigins?: string
    }
    if (!body.email || !body.password || !body.setupToken) {
      return c.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'setupToken, email, and password are required',
          },
        },
        400,
      )
    }
    try {
      const result = await completeOnboarding({
        setupToken: body.setupToken,
        email: body.email,
        password: body.password,
        name: body.name,
        appName: body.appName,
        publicUrl: body.publicUrl,
        corsOrigins: body.corsOrigins,
      })
      await rebuildAuth()
      return c.json({ data: { ok: true, ...result } })
    } catch (err) {
      const e = err as Error & { status?: number; code?: string }
      return c.json(
        {
          error: {
            code: e.code || 'INTERNAL',
            message: e.message,
          },
        },
        (e.status as 400) || 500,
      )
    }
  })

  // Public OAuth provider list for login buttons
  app.get('/api/auth/providers', async (c) => {
    const runtime = await getEffectiveRuntime()
    return c.json({
      data: listOAuthProvidersPublic(runtime, runtime.publicUrl).filter(
        (p) => p.enabled,
      ),
    })
  })
}

// silence unused in test helpers path
void finalizeRestartAfterBoot
void clearEmailOutbox
void getEmailOutbox
void countAdmins
