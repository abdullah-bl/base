import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { admin, formatTs } from '../api'

type AuditRow = {
  id?: string
  ts?: number
  action?: string
  actor?: string
  actorId?: string
  collection?: string
  recordId?: string
  before?: unknown
  after?: unknown
  [key: string]: unknown
}

export default function Audit() {
  const [action, setAction] = useState('')
  const [collection, setCollection] = useState('')
  const [selected, setSelected] = useState<AuditRow | null>(null)
  const [page, setPage] = useState(1)

  const q = useQuery({
    queryKey: ['admin', 'audit', action, collection, page],
    queryFn: () => {
      const params = new URLSearchParams({
        page: String(page),
        perPage: '50',
      })
      if (action) params.set('action', action)
      if (collection) params.set('collection', collection)
      return admin<{ data: AuditRow[]; meta: { total: number; page: number } }>(
        `/audit?${params}`,
      )
    },
  })

  return (
    <div>
      <h1 className="page-title">Audit</h1>
      <div className="toolbar">
        <input
          className="input"
          placeholder="action"
          value={action}
          onChange={(e) => {
            setAction(e.target.value)
            setPage(1)
          }}
        />
        <input
          className="input"
          placeholder="collection"
          value={collection}
          onChange={(e) => {
            setCollection(e.target.value)
            setPage(1)
          }}
        />
        <span className="muted">{q.data?.meta.total ?? '—'} events</span>
      </div>
      {q.error && <div className="error-banner">{(q.error as Error).message}</div>}
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>Time</th>
              <th>Action</th>
              <th>Actor</th>
              <th>Collection</th>
              <th>Record</th>
            </tr>
          </thead>
          <tbody>
            {(q.data?.data || []).map((r, i) => (
              <tr
                key={String(r.id ?? i)}
                style={{ cursor: 'pointer' }}
                onClick={() => setSelected(r)}
              >
                <td className="mono">{formatTs(r.ts)}</td>
                <td>{r.action || '—'}</td>
                <td className="mono">{String(r.actorId || r.actor || '—')}</td>
                <td>{r.collection || '—'}</td>
                <td className="mono">{String(r.recordId || '—').slice(0, 16)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="toolbar" style={{ marginTop: 8 }}>
        <button
          type="button"
          className="btn"
          disabled={page <= 1}
          onClick={() => setPage((p) => p - 1)}
        >
          Prev
        </button>
        <span className="muted">Page {page}</span>
        <button
          type="button"
          className="btn"
          disabled={(q.data?.data.length || 0) < 50}
          onClick={() => setPage((p) => p + 1)}
        >
          Next
        </button>
      </div>

      {selected && (
        <>
          <div className="drawer-backdrop" onClick={() => setSelected(null)} />
          <div className="drawer">
            <div className="toolbar">
              <strong>{selected.action}</strong>
              <button type="button" className="btn" onClick={() => setSelected(null)}>
                Close
              </button>
            </div>
            <pre className="mono" style={{ whiteSpace: 'pre-wrap', margin: 0 }}>
              {JSON.stringify(selected, null, 2)}
            </pre>
          </div>
        </>
      )}
    </div>
  )
}
