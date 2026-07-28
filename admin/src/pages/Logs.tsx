import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { admin, formatTs, streamAdminLogs } from '../api'

type LogEntry = {
  id?: string
  ts?: number
  level?: string
  kind?: string
  message?: string
  path?: string
  status?: number
  method?: string
  userId?: string
  [key: string]: unknown
}

export default function Logs() {
  const [level, setLevel] = useState('')
  const [kind, setKind] = useState('')
  const [path, setPath] = useState('')
  const [live, setLive] = useState(true)
  const [tail, setTail] = useState<LogEntry[]>([])
  const [streamErr, setStreamErr] = useState<string | null>(null)

  const q = useQuery({
    queryKey: ['admin', 'logs', level, kind, path],
    queryFn: () => {
      const params = new URLSearchParams({ perPage: '100' })
      if (level) params.set('level', level)
      if (kind) params.set('kind', kind)
      if (path) params.set('path', path)
      return admin<{ data: LogEntry[]; meta: { total: number } }>(
        `/logs?${params}`,
      )
    },
  })

  useEffect(() => {
    if (!live) return
    setStreamErr(null)
    const stop = streamAdminLogs(
      (entry) => {
        setTail((prev) => [entry as LogEntry, ...prev].slice(0, 200))
      },
      (err) => setStreamErr((err as Error).message),
    )
    return stop
  }, [live])

  const rows = live && tail.length ? tail : q.data?.data || []

  return (
    <div>
      <h1 className="page-title">Logs</h1>
      <div className="toolbar">
        <select className="select" value={level} onChange={(e) => setLevel(e.target.value)}>
          <option value="">All levels</option>
          <option value="debug">debug</option>
          <option value="info">info</option>
          <option value="warn">warn</option>
          <option value="error">error</option>
        </select>
        <input
          className="input"
          placeholder="kind"
          value={kind}
          onChange={(e) => setKind(e.target.value)}
        />
        <input
          className="input"
          placeholder="path contains"
          value={path}
          onChange={(e) => setPath(e.target.value)}
        />
        <label className="muted" style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
          <input
            type="checkbox"
            checked={live}
            onChange={(e) => {
              setLive(e.target.checked)
              if (e.target.checked) setTail([])
            }}
          />
          Live SSE
        </label>
        <button type="button" className="btn" onClick={() => void q.refetch()}>
          Refresh
        </button>
        {live && (
          <button type="button" className="btn" onClick={() => setTail([])}>
            Clear tail
          </button>
        )}
      </div>
      {(q.error || streamErr) && (
        <div className="error-banner">
          {streamErr || (q.error as Error).message}
        </div>
      )}
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>Time</th>
              <th>Level</th>
              <th>Kind</th>
              <th>Status</th>
              <th>Path</th>
              <th>Message</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={String(r.id ?? i)}>
                <td className="mono">{formatTs(r.ts)}</td>
                <td>{r.level || '—'}</td>
                <td>{r.kind || '—'}</td>
                <td className="mono">{r.status ?? '—'}</td>
                <td className="mono">
                  {r.method ? `${r.method} ` : ''}
                  {r.path || '—'}
                </td>
                <td title={String(r.message ?? '')}>
                  {String(r.message ?? '').slice(0, 120)}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">
                  {live ? 'Waiting for events…' : 'No logs'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
