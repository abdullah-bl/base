import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { admin } from '../api'

type RestartJob = {
  id: string
  status: string
  reason: string | null
  error: string | null
  createdAt: number
  updatedAt: number
  finishedAt: number | null
}

const STEPS = [
  'pending',
  'validating',
  'draining',
  'restarting',
  'health_check',
  'completed',
] as const

export default function System() {
  const qc = useQueryClient()
  const [confirm, setConfirm] = useState('')
  const [reason, setReason] = useState('')
  const [trackingId, setTrackingId] = useState<string | null>(null)
  const [clientPhase, setClientPhase] = useState<string | null>(null)

  const status = useQuery({
    queryKey: ['admin', 'restart'],
    queryFn: () =>
      admin<{ data: { draining: boolean; job: RestartJob | null } }>(
        '/system/restart',
      ),
    refetchInterval: trackingId ? 1000 : 5000,
  })

  const preflight = useQuery({
    queryKey: ['admin', 'restart-preflight'],
    queryFn: () =>
      admin<{
        data: {
          ok: boolean
          checks: Array<{ name: string; ok: boolean; detail?: string }>
        }
      }>('/system/restart/preflight', { method: 'POST', body: '{}' }),
  })

  const restart = useMutation({
    mutationFn: () =>
      admin<{ data: RestartJob }>('/system/restart', {
        method: 'POST',
        body: JSON.stringify({ confirm, reason }),
      }),
    onSuccess: (res) => {
      setTrackingId(res.data.id)
      setClientPhase('Validating')
      setConfirm('')
      qc.invalidateQueries({ queryKey: ['admin', 'restart'] })
    },
  })

  const job = status.data?.data.job
  const active =
    trackingId ||
    (job &&
      ['pending', 'validating', 'draining', 'restarting', 'health_check'].includes(
        job.status,
      ))

  useEffect(() => {
    if (!active || !job) return
    const map: Record<string, string> = {
      pending: 'Validating',
      validating: 'Validating',
      draining: 'Draining',
      restarting: 'Restarting',
      health_check: 'Health check',
      completed: 'Online',
      failed: 'Failed',
      rolled_back: 'Rolled back',
    }
    setClientPhase(map[job.status] || job.status)

    if (job.status === 'restarting' || job.status === 'draining') {
      let attempt = 0
      const timer = setInterval(async () => {
        attempt++
        try {
          const res = await fetch('/api/health/ready', { credentials: 'include' })
          if (res.ok) {
            setClientPhase('Online')
            setTrackingId(null)
            qc.invalidateQueries({ queryKey: ['admin', 'restart'] })
            clearInterval(timer)
          }
        } catch {
          setClientPhase(
            attempt < 30 ? 'Restarting… reconnecting' : 'Taking longer than expected',
          )
        }
      }, 1000)
      return () => clearInterval(timer)
    }
  }, [active, job?.status, job?.id, qc])

  return (
    <div>
      <h1 className="page-title">System</h1>
      <p className="muted" style={{ marginTop: -8, marginBottom: '1rem' }}>
        Restart Base safely with drain + health checks. Supervised mode relaunches the worker.
      </p>

      {clientPhase && active && (
        <div className="restart-banner">
          <div style={{ fontWeight: 600 }}>Base is {clientPhase.toLowerCase()}…</div>
          <div className="restart-steps">
            {STEPS.map((s) => {
              const idx = STEPS.indexOf(s)
              const cur = job ? STEPS.indexOf(job.status as (typeof STEPS)[number]) : 0
              const done = cur > idx || job?.status === 'completed'
              const current = job?.status === s
              return (
                <span
                  key={s}
                  className={`restart-step${done ? ' done' : ''}${current ? ' current' : ''}`}
                >
                  {s.replace('_', ' ')}
                </span>
              )
            })}
          </div>
          {job?.error && <div className="error-banner">{job.error}</div>}
        </div>
      )}

      <section className="panel" style={{ marginBottom: '1rem' }}>
        <h2 style={{ fontSize: 14, margin: '0 0 0.75rem' }}>Preflight</h2>
        {preflight.data?.data.checks.map((c) => (
          <div key={c.name} style={{ display: 'flex', gap: 8, fontSize: 13, marginBottom: 4 }}>
            <span>{c.ok ? '✅' : '❌'}</span>
            <span>
              {c.name}
              {c.detail ? ` — ${c.detail}` : ''}
            </span>
          </div>
        ))}
        <button
          type="button"
          className="btn"
          style={{ marginTop: 8 }}
          onClick={() => preflight.refetch()}
        >
          Re-check
        </button>
      </section>

      <section className="panel">
        <h2 style={{ fontSize: 14, margin: '0 0 0.75rem' }}>Restart Base</h2>
        <label className="field">
          <span>Reason (optional)</span>
          <input value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
        <label className="field">
          <span>
            Type <code>RESTART</code> to confirm
          </span>
          <input
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="RESTART"
            autoComplete="off"
          />
        </label>
        {restart.error && (
          <div className="error-banner">{(restart.error as Error).message}</div>
        )}
        <button
          type="button"
          className="btn danger"
          disabled={confirm !== 'RESTART' || restart.isPending || Boolean(active)}
          onClick={() => restart.mutate()}
        >
          {restart.isPending ? 'Starting…' : 'Restart Base'}
        </button>
        {job && (
          <div className="muted" style={{ marginTop: 10, fontSize: 12 }}>
            Last job: {job.id} · {job.status}
            {job.reason ? ` · ${job.reason}` : ''}
          </div>
        )}
      </section>
    </div>
  )
}
