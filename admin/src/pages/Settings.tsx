import { useQuery } from '@tanstack/react-query'
import { admin } from '../api'

export default function Settings() {
  const q = useQuery({
    queryKey: ['admin', 'settings'],
    queryFn: () =>
      admin<{
        data: {
          env: Record<string, unknown>
          features: Record<string, boolean>
        }
      }>('/settings'),
  })

  const d = q.data?.data

  return (
    <div>
      <h1 className="page-title">Settings</h1>
      {q.error && <div className="error-banner">{(q.error as Error).message}</div>}
      {d && (
        <>
          <h2 style={{ fontSize: 13, margin: '0 0 0.5rem' }}>Features</h2>
          <div className="table-wrap" style={{ marginBottom: '1rem' }}>
            <table className="data">
              <thead>
                <tr>
                  <th>Feature</th>
                  <th>Enabled</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(d.features).map(([k, v]) => (
                  <tr key={k}>
                    <td>{k}</td>
                    <td>{v ? 'yes' : 'no'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h2 style={{ fontSize: 13, margin: '0 0 0.5rem' }}>Environment</h2>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Key</th>
                  <th>Value</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(d.env)
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([k, v]) => (
                    <tr key={k}>
                      <td className="mono">{k}</td>
                      <td className="mono" title={String(v)}>
                        {v == null ? '—' : String(v)}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {!d && q.isLoading && <div className="muted">Loading…</div>}
    </div>
  )
}
