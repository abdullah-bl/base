import { useQuery } from '@tanstack/react-query'
import { admin, formatTs } from '../api'

type RealtimeData = {
  enabled: boolean
  subscribers: number
  recentEvents: Array<{
    id?: string
    collection?: string
    action?: string
    ts?: number
    recordId?: string
    [key: string]: unknown
  }>
}

export default function Realtime() {
  const q = useQuery({
    queryKey: ['admin', 'realtime'],
    queryFn: () => admin<{ data: RealtimeData }>('/realtime'),
    refetchInterval: 5_000,
  })

  const d = q.data?.data

  return (
    <div>
      <h1 className="page-title">Realtime</h1>
      {q.error && <div className="error-banner">{(q.error as Error).message}</div>}
      <div className="stat-grid">
        <div className="stat">
          <div className="label">Enabled</div>
          <div className="value">{d ? (d.enabled ? 'yes' : 'no') : '—'}</div>
        </div>
        <div className="stat">
          <div className="label">Subscribers</div>
          <div className="value">{d?.subscribers ?? '—'}</div>
        </div>
      </div>
      <h2 style={{ fontSize: 13, margin: '0 0 0.5rem' }}>Recent events</h2>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>Time</th>
              <th>Collection</th>
              <th>Action</th>
              <th>Record</th>
            </tr>
          </thead>
          <tbody>
            {(d?.recentEvents || []).map((e, i) => (
              <tr key={String(e.id ?? i)}>
                <td className="mono">{formatTs(e.ts)}</td>
                <td>{e.collection || '—'}</td>
                <td>{e.action || '—'}</td>
                <td className="mono">{String(e.recordId || '—')}</td>
              </tr>
            ))}
            {(d?.recentEvents.length || 0) === 0 && (
              <tr>
                <td colSpan={4} className="muted">
                  No recent events
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
