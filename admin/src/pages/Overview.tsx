import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { admin, formatBytes } from '../api'

type OverviewData = {
  version: string
  uptime: number
  nodeEnv: string
  storageDriver: string
  databaseUrl: string
  dbSize: number | null
  collections: Record<string, number>
  users: number
  admins: number
  realtimeSubscribers: number
  recentErrors24h: number
  adminPath: string
}

function fmtUptime(s: number) {
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = Math.floor(s % 60)
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${sec}s`
  return `${sec}s`
}

export default function Overview() {
  const q = useQuery({
    queryKey: ['admin', 'overview'],
    queryFn: () => admin<{ data: OverviewData }>('/overview'),
    refetchInterval: 15_000,
  })

  const d = q.data?.data

  return (
    <div>
      <h1 className="page-title">Overview</h1>
      {q.error && <div className="error-banner">{(q.error as Error).message}</div>}
      {!d && q.isLoading && <div className="muted">Loading…</div>}
      {d && (
        <>
          <div className="stat-grid">
            <div className="stat">
              <div className="label">Version</div>
              <div className="value mono">{d.version}</div>
            </div>
            <div className="stat">
              <div className="label">Uptime</div>
              <div className="value">{fmtUptime(d.uptime)}</div>
            </div>
            <div className="stat">
              <div className="label">Env</div>
              <div className="value">{d.nodeEnv}</div>
            </div>
            <div className="stat">
              <div className="label">Users</div>
              <div className="value">{d.users}</div>
            </div>
            <div className="stat">
              <div className="label">Admins</div>
              <div className="value">{d.admins}</div>
            </div>
            <div className="stat">
              <div className="label">Realtime</div>
              <div className="value">{d.realtimeSubscribers}</div>
            </div>
            <div className="stat">
              <div className="label">Errors 24h</div>
              <div className="value">{d.recentErrors24h}</div>
            </div>
            <div className="stat">
              <div className="label">DB size</div>
              <div className="value">{formatBytes(d.dbSize)}</div>
            </div>
          </div>

          <div className="panel" style={{ marginBottom: '0.75rem' }}>
            <div className="muted" style={{ marginBottom: 4 }}>
              Database
            </div>
            <div className="mono">{d.databaseUrl}</div>
            <div className="muted" style={{ marginTop: 8 }}>
              Storage: {d.storageDriver} · Admin path: {d.adminPath}
            </div>
          </div>

          <h2 style={{ fontSize: 13, margin: '0 0 0.5rem' }}>Collections</h2>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Rows</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(d.collections).map(([name, count]) => (
                  <tr key={name}>
                    <td>
                      <Link to={`/data/${name}`}>{name}</Link>
                    </td>
                    <td className="mono">{count}</td>
                  </tr>
                ))}
                {Object.keys(d.collections).length === 0 && (
                  <tr>
                    <td colSpan={2} className="muted">
                      No collections registered
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
