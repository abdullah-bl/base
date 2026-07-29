import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { admin } from '../api'

type Setting = {
  key: string
  displayValue: unknown
  source: string
  secret: boolean
  configured?: boolean
  applyMode: string
  section: string
  description: string
  dangerous?: boolean
}

const SECTION_LABELS: Record<string, string> = {
  general: 'General',
  auth: 'Auth',
  oauth: 'OAuth',
  email: 'Email',
  security: 'Security',
  cors: 'CORS',
  rate_limit: 'Rate limits',
  realtime: 'Realtime',
  logging: 'Logging',
  backup: 'Backups',
  storage: 'Storage',
  webhooks: 'Webhooks',
}

export default function Settings() {
  const qc = useQueryClient()
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [confirmDanger, setConfirmDanger] = useState(false)
  const [message, setMessage] = useState('')

  const q = useQuery({
    queryKey: ['admin', 'settings'],
    queryFn: () =>
      admin<{
        data: {
          settings: Setting[]
          bySection: Record<string, Setting[]>
          features: Record<string, boolean>
          bootstrap: Record<string, unknown>
        }
      }>('/settings'),
  })

  const settings = q.data?.data.settings || []
  const sections = useMemo(() => {
    const keys = [...new Set(settings.map((s) => s.section))]
    return keys
  }, [settings])

  const save = useMutation({
    mutationFn: async () => {
      const values: Record<string, unknown> = {}
      for (const [key, raw] of Object.entries(draft)) {
        const def = settings.find((s) => s.key === key)
        if (!def) continue
        if (def.secret && raw === '') continue
        let value: unknown = raw
        if (raw === 'true') value = true
        else if (raw === 'false') value = false
        else if (raw !== '' && !Number.isNaN(Number(raw)) && /^-?\d+(\.\d+)?$/.test(raw)) {
          value = Number(raw)
        }
        values[key] = value
      }
      return admin<{
        data: {
          requiresRestart: boolean
          requiresAuthRebuild: boolean
          updated: string[]
        }
      }>('/settings', {
        method: 'PATCH',
        body: JSON.stringify({ values, confirm: confirmDanger }),
      })
    },
    onSuccess: (res) => {
      setDraft({})
      setMessage(
        `Saved ${res.data.updated.length} setting(s)` +
          (res.data.requiresRestart
            ? ' — restart required (System → Restart)'
            : res.data.requiresAuthRebuild
              ? ' — auth rebuilt'
              : ''),
      )
      qc.invalidateQueries({ queryKey: ['admin', 'settings'] })
    },
  })

  function fieldValue(s: Setting): string {
    if (draft[s.key] !== undefined) return draft[s.key]
    if (s.secret) return ''
    if (typeof s.displayValue === 'boolean') return s.displayValue ? 'true' : 'false'
    return s.displayValue == null ? '' : String(s.displayValue)
  }

  return (
    <div>
      <h1 className="page-title">Settings</h1>
      <p className="muted" style={{ marginTop: -8, marginBottom: '1rem' }}>
        Runtime config stored encrypted in the database. Bootstrap secrets stay in{' '}
        <code>.env</code>.
      </p>

      {message && <div className="ok-banner">{message}</div>}
      {save.error && (
        <div className="error-banner">{(save.error as Error).message}</div>
      )}
      {q.error && <div className="error-banner">{(q.error as Error).message}</div>}

      {q.data?.data.bootstrap && (
        <section className="panel" style={{ marginBottom: '1rem' }}>
          <h2 style={{ fontSize: 14, margin: '0 0 0.5rem' }}>Bootstrap (env-only)</h2>
          <div className="table-wrap">
            <table className="data">
              <tbody>
                {Object.entries(q.data.data.bootstrap).map(([k, v]) => (
                  <tr key={k}>
                    <td className="mono">{k}</td>
                    <td className="mono">{String(v)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {sections.map((section) => (
        <section key={section} className="panel" style={{ marginBottom: '1rem' }}>
          <h2 style={{ fontSize: 14, margin: '0 0 0.75rem' }}>
            {SECTION_LABELS[section] || section}
          </h2>
          {settings
            .filter((s) => s.section === section)
            .map((s) => (
              <label key={s.key} className="field">
                <span>
                  {s.key}{' '}
                  <span className="faint">
                    ({s.source} · {s.applyMode}
                    {s.dangerous ? ' · dangerous' : ''}
                    {s.secret && s.configured ? ' · configured' : ''})
                  </span>
                </span>
                <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>
                  {s.description}
                </div>
                {typeof s.displayValue === 'boolean' && !s.secret ? (
                  <select
                    value={fieldValue(s)}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, [s.key]: e.target.value }))
                    }
                  >
                    <option value="true">true</option>
                    <option value="false">false</option>
                  </select>
                ) : (
                  <input
                    type={s.secret ? 'password' : 'text'}
                    value={fieldValue(s)}
                    placeholder={
                      s.secret
                        ? s.configured
                          ? '•••••••• (leave blank to keep)'
                          : 'Enter secret'
                        : undefined
                    }
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, [s.key]: e.target.value }))
                    }
                  />
                )}
              </label>
            ))}
        </section>
      ))}

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 40 }}>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
          <input
            type="checkbox"
            checked={confirmDanger}
            onChange={(e) => setConfirmDanger(e.target.checked)}
          />
          Confirm dangerous changes
        </label>
        <button
          type="button"
          className="btn primary"
          disabled={Object.keys(draft).length === 0 || save.isPending}
          onClick={() => {
            setMessage('')
            save.mutate()
          }}
        >
          {save.isPending ? 'Saving…' : 'Save settings'}
        </button>
      </div>
    </div>
  )
}
