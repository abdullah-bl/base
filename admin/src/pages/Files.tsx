import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { admin, formatBytes, formatTs } from '../api'

type FileRow = {
  id: string
  filename?: string
  contentType?: string
  size?: number
  storageKey?: string
  ownerId?: string
  createdAt?: number
}

export default function Files() {
  const [page, setPage] = useState(1)
  const qc = useQueryClient()

  const stats = useQuery({
    queryKey: ['admin', 'files', 'stats'],
    queryFn: () =>
      admin<{ data: { count: number; bytes: number; driver: string } }>(
        '/files/stats',
      ),
  })

  const list = useQuery({
    queryKey: ['admin', 'files', page],
    queryFn: () =>
      admin<{ data: FileRow[]; meta: { total: number } }>(
        `/files?page=${page}&perPage=50`,
      ),
  })

  const del = useMutation({
    mutationFn: (id: string) => admin(`/files/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'files'] })
    },
  })

  const s = stats.data?.data

  return (
    <div>
      <h1 className="page-title">Files</h1>
      <div className="stat-grid">
        <div className="stat">
          <div className="label">Count</div>
          <div className="value">{s?.count ?? '—'}</div>
        </div>
        <div className="stat">
          <div className="label">Bytes</div>
          <div className="value">{formatBytes(s?.bytes)}</div>
        </div>
        <div className="stat">
          <div className="label">Driver</div>
          <div className="value">{s?.driver ?? '—'}</div>
        </div>
      </div>
      {(list.error || del.error) && (
        <div className="error-banner">
          {((list.error || del.error) as Error).message}
        </div>
      )}
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>Filename</th>
              <th>Type</th>
              <th>Size</th>
              <th>Owner</th>
              <th>Created</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {(list.data?.data || []).map((f) => (
              <tr key={f.id}>
                <td title={f.id}>{f.filename || f.id}</td>
                <td className="mono">{f.contentType || '—'}</td>
                <td className="mono">{formatBytes(f.size)}</td>
                <td className="mono">{f.ownerId?.slice(0, 12) || '—'}</td>
                <td className="mono">{formatTs(f.createdAt)}</td>
                <td>
                  <button
                    type="button"
                    className="btn btn-danger"
                    onClick={() => {
                      if (confirm('Delete this file?')) del.mutate(f.id)
                    }}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {!list.isLoading && (list.data?.data.length || 0) === 0 && (
              <tr>
                <td colSpan={6} className="muted">
                  No files
                </td>
              </tr>
            )}
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
          disabled={(list.data?.data.length || 0) < 50}
          onClick={() => setPage((p) => p + 1)}
        >
          Next
        </button>
      </div>
    </div>
  )
}
