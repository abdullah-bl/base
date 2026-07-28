import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { admin } from '../api'

type Collection = {
  name: string
  fields: Record<string, unknown>
  indexes?: unknown
  access?: unknown
  fingerprint: string
  storedFingerprint: string | null
  rowCount: number
}

export default function Collections() {
  const [selected, setSelected] = useState<string | null>(null)
  const qc = useQueryClient()

  const list = useQuery({
    queryKey: ['admin', 'collections'],
    queryFn: () => admin<{ data: Collection[] }>('/collections'),
  })

  const status = useQuery({
    queryKey: ['admin', 'schema', 'status'],
    queryFn: () =>
      admin<{ data: { plan: unknown; formatted: string } }>('/schema/status'),
  })

  const apply = useMutation({
    mutationFn: () =>
      admin('/schema/apply', { method: 'POST', body: '{}' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'collections'] })
      void qc.invalidateQueries({ queryKey: ['admin', 'schema'] })
    },
  })

  const migrations = useQuery({
    queryKey: ['admin', 'migrations'],
    queryFn: () =>
      admin<{ data: Record<string, unknown>[]; meta: { total: number } }>(
        '/migrations?perPage=20',
      ),
  })

  const col = list.data?.data.find((c) => c.name === selected)

  return (
    <div>
      <h1 className="page-title">Collections</h1>
      <div className="toolbar">
        <button
          type="button"
          className="btn"
          onClick={() => void status.refetch()}
        >
          Refresh schema status
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={apply.isPending}
          onClick={() => {
            if (confirm('Apply additive schema evolution?')) apply.mutate()
          }}
        >
          Apply schema
        </button>
      </div>
      {(list.error || status.error || apply.error) && (
        <div className="error-banner">
          {(list.error || status.error || apply.error) instanceof Error
            ? ((list.error || status.error || apply.error) as Error).message
            : 'Error'}
        </div>
      )}

      {status.data && (
        <pre
          className="panel mono"
          style={{ marginBottom: '0.75rem', whiteSpace: 'pre-wrap', maxHeight: 160, overflow: 'auto' }}
        >
          {status.data.data.formatted || 'Schema up to date'}
        </pre>
      )}

      <div className="table-wrap" style={{ marginBottom: '1rem' }}>
        <table className="data">
          <thead>
            <tr>
              <th>Name</th>
              <th>Rows</th>
              <th>Fingerprint</th>
              <th>Drift</th>
            </tr>
          </thead>
          <tbody>
            {(list.data?.data || []).map((c) => {
              const drift =
                c.storedFingerprint && c.storedFingerprint !== c.fingerprint
              return (
                <tr
                  key={c.name}
                  style={{ cursor: 'pointer' }}
                  onClick={() => setSelected(c.name)}
                >
                  <td>{c.name}</td>
                  <td className="mono">{c.rowCount}</td>
                  <td className="mono faint">{c.fingerprint.slice(0, 12)}…</td>
                  <td>{drift ? 'yes' : 'no'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {col && (
        <div className="panel" style={{ marginBottom: '1rem' }}>
          <div className="toolbar">
            <strong>{col.name}</strong>
            <button type="button" className="btn" onClick={() => setSelected(null)}>
              Close
            </button>
          </div>
          <pre className="mono" style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
            {JSON.stringify(
              { fields: col.fields, indexes: col.indexes, access: col.access },
              null,
              2,
            )}
          </pre>
        </div>
      )}

      <h2 style={{ fontSize: 13, margin: '0 0 0.5rem' }}>
        Migrations ({migrations.data?.meta.total ?? '—'})
      </h2>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>ID</th>
              <th>Applied</th>
            </tr>
          </thead>
          <tbody>
            {(migrations.data?.data || []).map((m, i) => (
              <tr key={String(m.id ?? i)}>
                <td className="mono">{String(m.id ?? m.name ?? '—')}</td>
                <td className="mono">{String(m.appliedAt ?? '—')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
