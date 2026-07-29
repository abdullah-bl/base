import { useQuery } from '@tanstack/react-query'
import { admin } from '../api'

export default function Security() {
  const q = useQuery({
    queryKey: ['admin', 'security'],
    queryFn: () =>
      admin<{
        data: {
          score: number
          passed: number
          failed: number
          checks: Array<{
            id: string
            severity: string
            ok: boolean
            title: string
            detail: string
            remediations?: string[]
          }>
        }
      }>('/security/checklist'),
    refetchInterval: 30_000,
  })

  const d = q.data?.data

  return (
    <div>
      <h1 className="page-title">Security</h1>
      {q.error && <div className="error-banner">{(q.error as Error).message}</div>}
      {d && (
        <>
          <div className="stat-grid" style={{ marginBottom: '1rem' }}>
            <div className="stat">
              <div className="stat-value">{d.score}</div>
              <div className="stat-label">Score</div>
            </div>
            <div className="stat">
              <div className="stat-value">{d.passed}</div>
              <div className="stat-label">Passed</div>
            </div>
            <div className="stat">
              <div className="stat-value">{d.failed}</div>
              <div className="stat-label">Failed</div>
            </div>
          </div>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th></th>
                  <th>Check</th>
                  <th>Severity</th>
                  <th>Detail</th>
                </tr>
              </thead>
              <tbody>
                {d.checks.map((c) => (
                  <tr key={c.id}>
                    <td>{c.ok ? '✅' : '❌'}</td>
                    <td>
                      <div>{c.title}</div>
                      {!c.ok && c.remediations?.length ? (
                        <div className="muted" style={{ fontSize: 12 }}>
                          {c.remediations.join(' · ')}
                        </div>
                      ) : null}
                    </td>
                    <td className="mono">{c.severity}</td>
                    <td className="mono">{c.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {!d && q.isLoading && <div className="muted">Running checks…</div>}
    </div>
  )
}
