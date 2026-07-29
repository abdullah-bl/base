import { getClient } from '../db/client.js'
import { isMaintenanceMode, setMaintenanceMode } from './maintenance.js'
import {
  createRestartJob,
  getLatestRestartJob,
  getRestartJob,
  updateRestartJob,
  type RestartJob,
} from '../settings/store.js'
import { closeAllForShutdown } from '../realtime/bus.js'
import { stopBackupSchedule } from '../backup/index.js'
import { writeAudit } from '../observability/audit.js'

/** Exit code supervisor watches for intentional restart */
export const RESTART_EXIT_CODE = 75

let activeServer:
  | (ReturnType<typeof Bun.serve> & { reload?: (opts: { fetch: typeof fetch }) => void })
  | null = null
let draining = false

export function setActiveServer(server: ReturnType<typeof Bun.serve> | null): void {
  activeServer = server as typeof activeServer
}

export function isDraining(): boolean {
  return draining
}

export async function getRestartStatus(): Promise<{
  draining: boolean
  job: RestartJob | null
}> {
  return {
    draining,
    job: await getLatestRestartJob(),
  }
}

/**
 * Preflight checks before restart — must not leave the process unrecoverable.
 */
export async function preflightRestart(): Promise<{
  ok: boolean
  checks: Array<{ name: string; ok: boolean; detail?: string }>
}> {
  const checks: Array<{ name: string; ok: boolean; detail?: string }> = []

  try {
    await getClient().execute('SELECT 1')
    checks.push({ name: 'database', ok: true })
  } catch (err) {
    checks.push({
      name: 'database',
      ok: false,
      detail: err instanceof Error ? err.message : 'db error',
    })
  }

  if (isMaintenanceMode()) {
    checks.push({
      name: 'maintenance',
      ok: false,
      detail: 'Cannot restart while another maintenance operation is active',
    })
  } else {
    checks.push({ name: 'maintenance', ok: true })
  }

  const latest = await getLatestRestartJob()
  if (
    latest &&
    ['pending', 'validating', 'draining', 'restarting', 'health_check'].includes(
      latest.status,
    )
  ) {
    checks.push({
      name: 'concurrent',
      ok: false,
      detail: `Restart job ${latest.id} already ${latest.status}`,
    })
  } else {
    checks.push({ name: 'concurrent', ok: true })
  }

  return {
    ok: checks.every((c) => c.ok),
    checks,
  }
}

export async function requestRestart(opts: {
  reason?: string
  actorId?: string | null
  actorKind?: string | null
  confirm: string
  requestId?: string
}): Promise<RestartJob> {
  if (opts.confirm !== 'RESTART') {
    throw Object.assign(
      new Error('Confirmation failed — type RESTART to confirm'),
      { status: 400, code: 'CONFIRM_REQUIRED' },
    )
  }

  const pre = await preflightRestart()
  if (!pre.ok) {
    throw Object.assign(
      new Error(
        `Restart preflight failed: ${pre.checks
          .filter((c) => !c.ok)
          .map((c) => c.detail || c.name)
          .join('; ')}`,
      ),
      { status: 409, code: 'RESTART_PREFLIGHT_FAILED', details: pre.checks },
    )
  }

  const job = await createRestartJob({
    reason: opts.reason,
    actorId: opts.actorId,
    actorKind: opts.actorKind,
  })

  void writeAudit({
    actor: opts.actorId
      ? opts.actorKind === 'token' || opts.actorKind === 'admin_token'
        ? { kind: 'admin_token' }
        : { kind: 'user', userId: opts.actorId }
      : null,
    action: 'system.restart',
    after: { jobId: job.id, reason: opts.reason },
    requestId: opts.requestId,
  })

  // Fire-and-forget drain + exit (response already returning 202)
  void runRestartSequence(job.id)

  return job
}

async function runRestartSequence(jobId: string): Promise<void> {
  try {
    await updateRestartJob(jobId, { status: 'validating' })
    const pre = await preflightRestart()
    // concurrent check will fail because our job is pending — re-check only db/maintenance
    const dbOk = pre.checks.find((c) => c.name === 'database')?.ok
    const maintOk = pre.checks.find((c) => c.name === 'maintenance')?.ok
    if (!dbOk || !maintOk) {
      await updateRestartJob(jobId, {
        status: 'failed',
        error: 'Preflight failed during restart',
        finishedAt: Date.now(),
      })
      return
    }

    await updateRestartJob(jobId, { status: 'draining' })
    draining = true
    setMaintenanceMode(true, 'Server is restarting')

    // Brief drain window for in-flight requests
    await sleep(1500)

    closeAllForShutdown()
    stopBackupSchedule()

    await updateRestartJob(jobId, { status: 'restarting' })

    // Prefer supervisor hand-off
    if (process.env.BASE_SUPERVISED === '1') {
      // Give the HTTP response time to flush
      await sleep(300)
      process.exit(RESTART_EXIT_CODE)
      return
    }

    // Fallback: in-process reload (dev / unsupervised)
    await updateRestartJob(jobId, { status: 'health_check' })
    const { createApp } = await import('./hono-app.js')
    const { resetDefaultAppForTests } = await import('./hono-app.js')
    resetDefaultAppForTests()
    const app = createApp()
    if (activeServer && typeof activeServer.reload === 'function') {
      activeServer.reload({ fetch: app.fetch.bind(app) })
    }
    setMaintenanceMode(false)
    draining = false
    await updateRestartJob(jobId, {
      status: 'completed',
      finishedAt: Date.now(),
    })
  } catch (err) {
    draining = false
    setMaintenanceMode(false)
    await updateRestartJob(jobId, {
      status: 'failed',
      error: err instanceof Error ? err.message : String(err),
      finishedAt: Date.now(),
    })
  }
}

/** Called by worker after boot when a restart job is mid-flight */
export async function finalizeRestartAfterBoot(): Promise<void> {
  const job = await getLatestRestartJob()
  if (!job) return
  if (['restarting', 'health_check', 'draining', 'pending', 'validating'].includes(job.status)) {
    try {
      await getClient().execute('SELECT 1')
      await updateRestartJob(job.id, {
        status: 'completed',
        finishedAt: Date.now(),
      })
    } catch (err) {
      await updateRestartJob(job.id, {
        status: 'failed',
        error: err instanceof Error ? err.message : String(err),
        finishedAt: Date.now(),
      })
    }
  }
  setMaintenanceMode(false)
  draining = false
}

export async function getRestartJobPublic(id: string): Promise<RestartJob | null> {
  return getRestartJob(id)
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
